use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{OcrServiceError, Result};
use crate::models::{OcrActivePackage, OcrManifest, OcrManifestFile, OcrPrepareProgress};
use crate::paths::{
    MANIFEST_FILE, MANIFEST_URLS, OCR_PROFILE, OcrPackagePaths, OcrStoragePaths,
    required_model_files,
};

const OCR_PREPARE_EVENT: &str = "ocr:prepare-progress";
const HTTP_TIMEOUT: Duration = Duration::from_secs(180);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const BUFFER_SIZE: usize = 64 * 1024;
const DOWNLOAD_RETRY_BACKOFFS_MS: &[u64] = &[800, 2_000];
const FILE_MIRROR_BASES: &[&str] = &[
    "https://gitee.com/winriseF/models/raw/master/",
    "https://gcore.jsdelivr.net/gh/WinriseF/CtxRun@main/",
    "https://cdn.jsdelivr.net/gh/WinriseF/CtxRun@main/",
    "https://raw.githubusercontent.com/WinriseF/CtxRun/main/",
];

pub fn ensure_models_downloaded<R: Runtime>(
    app: &AppHandle<R>,
    storage: &OcrStoragePaths,
) -> Result<OcrPackagePaths> {
    storage.ensure_root_dirs()?;

    let (manifest_url, manifest_raw, manifest) = fetch_manifest()?;
    let release_tag = manifest.release_tag().to_string();
    let package = storage.package(release_tag.clone());

    if package.is_complete() {
        write_active_package(
            storage,
            &OcrActivePackage {
                profile_id: OCR_PROFILE.to_string(),
                release_tag,
                prepared_at: Utc::now().to_rfc3339(),
            },
        )?;
        return Ok(package);
    }

    let required_files = required_manifest_files(&manifest)?;
    let total_bytes = required_files.iter().map(|file| file.size).sum();

    emit_progress(
        app,
        OcrPrepareProgress {
            stage: "started".to_string(),
            release_tag: Some(package.release_tag.clone()),
            current_file: None,
            completed_files: 0,
            total_files: required_files.len(),
            downloaded_bytes: 0,
            total_bytes,
            message: Some(format!("Preparing OCR models from {manifest_url}")),
        },
    );

    let temp_dir = temp_package_dir(storage, &package.release_tag);
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
    }
    fs::create_dir_all(&temp_dir)?;

    let download_result = (|| -> Result<()> {
        let client = build_http_client()?;
        let mut downloaded_bytes = 0u64;

        for (index, file) in required_files.iter().enumerate() {
            download_file(
                &client,
                file,
                &temp_dir.join(&file.name),
                index,
                required_files.len(),
                &manifest.release.repository,
                &package.release_tag,
                &mut downloaded_bytes,
                total_bytes,
                app,
            )?;
        }

        fs::write(temp_dir.join(MANIFEST_FILE), manifest_raw.as_bytes())?;
        Ok(())
    })();

    if let Err(err) = download_result {
        let _ = fs::remove_dir_all(&temp_dir);
        emit_progress(
            app,
            OcrPrepareProgress {
                stage: "failed".to_string(),
                release_tag: Some(package.release_tag.clone()),
                current_file: None,
                completed_files: 0,
                total_files: required_files.len(),
                downloaded_bytes: 0,
                total_bytes,
                message: Some(err.to_string()),
            },
        );
        return Err(err);
    }

    if package.package_dir.exists() {
        ensure_package_path(storage, &package.package_dir)?;
        fs::remove_dir_all(&package.package_dir)?;
    }
    fs::rename(&temp_dir, &package.package_dir)?;

    write_active_package(
        storage,
        &OcrActivePackage {
            profile_id: OCR_PROFILE.to_string(),
            release_tag: package.release_tag.clone(),
            prepared_at: Utc::now().to_rfc3339(),
        },
    )?;

    emit_progress(
        app,
        OcrPrepareProgress {
            stage: "completed".to_string(),
            release_tag: Some(package.release_tag.clone()),
            current_file: None,
            completed_files: required_files.len(),
            total_files: required_files.len(),
            downloaded_bytes: total_bytes,
            total_bytes,
            message: Some("OCR models are ready".to_string()),
        },
    );

    Ok(package)
}

pub fn read_active_package(storage: &OcrStoragePaths) -> Result<Option<OcrActivePackage>> {
    if !storage.active_package_file.is_file() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&storage.active_package_file)?;
    let active = serde_json::from_str::<OcrActivePackage>(&contents)
        .map_err(|err| OcrServiceError::ActivePackageInvalid(err.to_string()))?;

    if active.profile_id != OCR_PROFILE {
        return Err(OcrServiceError::ActivePackageInvalid(format!(
            "expected profile {OCR_PROFILE}, got {}",
            active.profile_id
        )));
    }

    Ok(Some(active))
}

fn write_active_package(storage: &OcrStoragePaths, active: &OcrActivePackage) -> Result<()> {
    storage.ensure_root_dirs()?;
    let temp_path = storage.active_package_file.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(active)?;
    fs::write(&temp_path, payload)?;
    if storage.active_package_file.exists() {
        fs::remove_file(&storage.active_package_file)?;
    }
    fs::rename(temp_path, &storage.active_package_file)?;
    Ok(())
}

fn build_http_client() -> Result<Client> {
    Client::builder()
        .timeout(HTTP_TIMEOUT)
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .user_agent("CtxRun OCR Downloader/1.0")
        .build()
        .map_err(|err| OcrServiceError::ManifestFetchFailed(err.to_string()))
}

fn fetch_manifest() -> Result<(String, String, OcrManifest)> {
    let client = build_http_client()?;
    let mut errors = Vec::new();

    for url in MANIFEST_URLS {
        match client.get(*url).send() {
            Ok(response) => match response.error_for_status() {
                Ok(success) => match success.text() {
                    Ok(body) => match serde_json::from_str::<OcrManifest>(&body) {
                        Ok(manifest) => {
                            if manifest.release_tag().trim().is_empty() {
                                errors.push(format!("{url}: release tag is empty"));
                                continue;
                            }
                            return Ok(((*url).to_string(), body, manifest));
                        }
                        Err(err) => errors.push(format!("{url}: invalid JSON: {err}")),
                    },
                    Err(err) => errors.push(format!("{url}: failed to read body: {err}")),
                },
                Err(err) => errors.push(format!("{url}: {err}")),
            },
            Err(err) => errors.push(format!("{url}: {err}")),
        }
    }

    Err(OcrServiceError::ManifestFetchFailed(errors.join(" | ")))
}

fn required_manifest_files(manifest: &OcrManifest) -> Result<Vec<OcrManifestFile>> {
    let mut selected = Vec::new();
    let mut missing = Vec::new();

    for required in required_model_files() {
        match manifest.files.iter().find(|file| file.name == *required) {
            Some(file) => selected.push(file.clone()),
            None => missing.push((*required).to_string()),
        }
    }

    if missing.is_empty() {
        Ok(selected)
    } else {
        Err(OcrServiceError::ManifestInvalid(format!(
            "release {} is missing required files: {missing:?}",
            manifest.release_tag()
        )))
    }
}

#[allow(clippy::too_many_arguments)]
fn download_file<R: Runtime>(
    client: &Client,
    file: &OcrManifestFile,
    destination: &Path,
    index: usize,
    total_files: usize,
    release_repository: &str,
    release_tag: &str,
    downloaded_bytes: &mut u64,
    total_bytes: u64,
    app: &AppHandle<R>,
) -> Result<()> {
    let candidate_urls = candidate_download_urls(file, release_repository, release_tag);
    let mut failures = Vec::new();

    for url in &candidate_urls {
        let source = source_label(url);
        let mut retry_index = 0usize;

        loop {
            match download_file_once(
                client,
                url,
                file,
                destination,
                index,
                total_files,
                release_tag,
                *downloaded_bytes,
                total_bytes,
                app,
            ) {
                Ok(file_bytes) => {
                    *downloaded_bytes += file_bytes;
                    return Ok(());
                }
                Err(DownloadAttemptFailure::Fatal(err)) => return Err(err),
                Err(DownloadAttemptFailure::Source {
                    reason,
                    retry_same_source,
                }) => {
                    failures.push(format!("{source} (attempt {}): {reason}", retry_index + 1));

                    if retry_same_source {
                        if let Some(delay) = retry_backoff(retry_index) {
                            emit_progress(
                                app,
                                OcrPrepareProgress {
                                    stage: "retrying".to_string(),
                                    release_tag: Some(release_tag.to_string()),
                                    current_file: Some(file.name.clone()),
                                    completed_files: index,
                                    total_files,
                                    downloaded_bytes: *downloaded_bytes,
                                    total_bytes,
                                    message: Some(format!(
                                        "Retrying {} via {} in {} ms",
                                        file.name,
                                        source,
                                        delay.as_millis()
                                    )),
                                },
                            );
                            std::thread::sleep(delay);
                            retry_index += 1;
                            continue;
                        }
                    }

                    break;
                }
            }
        }
    }

    Err(OcrServiceError::DownloadFailed {
        file: file.name.clone(),
        reason: failures.join(" | "),
    })
}

enum DownloadAttemptFailure {
    Source {
        reason: String,
        retry_same_source: bool,
    },
    Fatal(OcrServiceError),
}

#[allow(clippy::too_many_arguments)]
fn download_file_once<R: Runtime>(
    client: &Client,
    url: &str,
    file: &OcrManifestFile,
    destination: &Path,
    index: usize,
    total_files: usize,
    release_tag: &str,
    completed_downloaded_bytes: u64,
    total_bytes: u64,
    app: &AppHandle<R>,
) -> std::result::Result<u64, DownloadAttemptFailure> {
    let temp_path = destination.with_extension("part");
    cleanup_partial_file(&temp_path);

    let mut response = client
        .get(url)
        .send()
        .map_err(|err| download_source_error(err.to_string(), is_retryable_request_error(&err)))?;

    let status = response.status();
    if !status.is_success() {
        cleanup_partial_file(&temp_path);
        return Err(download_source_error(
            format!("HTTP status {status} for url({url})"),
            retryable_status(status),
        ));
    }

    let mut output =
        fs::File::create(&temp_path).map_err(|err| DownloadAttemptFailure::Fatal(err.into()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; BUFFER_SIZE];
    let mut file_bytes = 0u64;

    loop {
        let read = response.read(&mut buffer).map_err(|err| {
            cleanup_partial_file(&temp_path);
            download_source_error(err.to_string(), true)
        })?;
        if read == 0 {
            break;
        }

        output.write_all(&buffer[..read]).map_err(|err| {
            cleanup_partial_file(&temp_path);
            DownloadAttemptFailure::Fatal(err.into())
        })?;
        hasher.update(&buffer[..read]);
        file_bytes += read as u64;

        emit_progress(
            app,
            OcrPrepareProgress {
                stage: "downloading".to_string(),
                release_tag: Some(release_tag.to_string()),
                current_file: Some(file.name.clone()),
                completed_files: index,
                total_files,
                downloaded_bytes: completed_downloaded_bytes + file_bytes,
                total_bytes,
                message: Some(format!(
                    "Downloading {} via {}",
                    file.name,
                    source_label(url)
                )),
            },
        );
    }

    output.flush().map_err(|err| {
        cleanup_partial_file(&temp_path);
        DownloadAttemptFailure::Fatal(err.into())
    })?;

    if file_bytes != file.size {
        cleanup_partial_file(&temp_path);
        return Err(download_source_error(
            format!(
                "expected {} bytes, got {} from {url}",
                file.size, file_bytes
            ),
            true,
        ));
    }

    let actual_sha256 = sha256_hex(&hasher.finalize());
    if actual_sha256 != file.sha256.to_ascii_lowercase() {
        cleanup_partial_file(&temp_path);
        return Err(download_source_error(
            format!(
                "checksum mismatch from {url}: expected {}, got {}",
                file.sha256, actual_sha256
            ),
            false,
        ));
    }

    fs::rename(&temp_path, destination).map_err(|err| {
        cleanup_partial_file(&temp_path);
        DownloadAttemptFailure::Fatal(err.into())
    })?;
    emit_progress(
        app,
        OcrPrepareProgress {
            stage: "downloaded".to_string(),
            release_tag: Some(release_tag.to_string()),
            current_file: Some(file.name.clone()),
            completed_files: index + 1,
            total_files,
            downloaded_bytes: completed_downloaded_bytes + file_bytes,
            total_bytes,
            message: Some(format!(
                "Downloaded {} via {}",
                file.name,
                source_label(url)
            )),
        },
    );
    Ok(file_bytes)
}

fn candidate_download_urls(
    file: &OcrManifestFile,
    release_repository: &str,
    release_tag: &str,
) -> Vec<String> {
    let mut urls = Vec::new();
    push_unique_url(&mut urls, &file.url);

    for mirror in &file.mirrors {
        push_unique_url(&mut urls, mirror);
    }

    if let Some(relative_path) = file
        .mirrors
        .iter()
        .find_map(|url| mirror_relative_path(url))
        .or_else(|| mirror_relative_path(&file.url))
    {
        for base in FILE_MIRROR_BASES {
            push_unique_url(&mut urls, &format!("{base}{relative_path}"));
        }
    }

    if let Some(url) = github_release_asset_url(release_repository, release_tag, &file.name) {
        push_unique_url(&mut urls, &url);
    }

    urls
}

fn mirror_relative_path(url: &str) -> Option<String> {
    let trimmed = url.trim();
    FILE_MIRROR_BASES.iter().find_map(|base| {
        trimmed
            .strip_prefix(base)
            .map(|path| path.trim_start_matches('/').to_string())
    })
}

fn github_release_asset_url(
    release_repository: &str,
    release_tag: &str,
    file_name: &str,
) -> Option<String> {
    let release_repository = release_repository.trim().trim_matches('/');
    let release_tag = release_tag.trim();
    if release_repository.is_empty() || release_tag.is_empty() {
        return None;
    }

    let mut url = reqwest::Url::parse("https://github.com/").ok()?;
    {
        let mut segments = url.path_segments_mut().ok()?;
        for segment in release_repository.split('/') {
            if !segment.is_empty() {
                segments.push(segment);
            }
        }
        segments.push("releases");
        segments.push("download");
        segments.push(release_tag);
        segments.push(file_name);
    }

    Some(url.to_string())
}

fn push_unique_url(urls: &mut Vec<String>, url: &str) {
    let trimmed = url.trim();
    if trimmed.is_empty() || urls.iter().any(|existing| existing == trimmed) {
        return;
    }
    urls.push(trimmed.to_string());
}

fn source_label(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

fn retry_backoff(attempt_index: usize) -> Option<Duration> {
    DOWNLOAD_RETRY_BACKOFFS_MS
        .get(attempt_index)
        .copied()
        .map(Duration::from_millis)
}

fn retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn is_retryable_request_error(err: &reqwest::Error) -> bool {
    err.is_timeout()
        || err.is_connect()
        || err.is_body()
        || err.status().is_some_and(retryable_status)
}

fn download_source_error(reason: String, retry_same_source: bool) -> DownloadAttemptFailure {
    DownloadAttemptFailure::Source {
        reason,
        retry_same_source,
    }
}

fn cleanup_partial_file(path: &Path) {
    let _ = fs::remove_file(path);
}

fn temp_package_dir(storage: &OcrStoragePaths, release_tag: &str) -> PathBuf {
    storage.packages_dir.join(format!(
        ".tmp-{release_tag}-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    ))
}

fn ensure_package_path(storage: &OcrStoragePaths, package_dir: &Path) -> Result<()> {
    if package_dir.starts_with(&storage.packages_dir) {
        Ok(())
    } else {
        Err(OcrServiceError::Message(format!(
            "refusing to modify path outside OCR packages root: {}",
            package_dir.to_string_lossy()
        )))
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, payload: OcrPrepareProgress) {
    let _ = app.emit(OCR_PREPARE_EVENT, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> OcrManifest {
        serde_json::from_str(
            r#"{
              "schema_version": 1,
              "profile_id": "ocr-all-models",
              "title": "OCR model bundle",
              "version": "ocr-models-20260409-abcd123",
              "generated_at": "2026-04-09T00:00:00Z",
              "source": {
                "repository": "zibo-chen/rust-paddle-ocr",
                "branch": "next",
                "path": "models",
                "commit": "abcd1234",
                "committed_at": "2026-04-09T00:00:00Z"
              },
              "release": {
                "repository": "WinriseF/CtxRun",
                "tag": "ocr-models-20260409-abcd123",
                "url": "https://github.com/WinriseF/CtxRun/releases/tag/ocr-models-20260409-abcd123"
              },
              "files": [
                {"name":"PP-OCRv5_mobile_det.mnn","size":1,"sha256":"00","url":"https://example.com/det"},
                {"name":"PP-OCRv5_mobile_rec.mnn","size":1,"sha256":"00","url":"https://example.com/rec"},
                {"name":"ppocr_keys_v5.txt","size":1,"sha256":"00","url":"https://example.com/keys"},
                {"name":"PP-LCNet_x1_0_doc_ori.mnn","size":1,"sha256":"00","url":"https://example.com/ori"}
              ]
            }"#,
        )
        .expect("parse manifest")
    }

    #[test]
    fn selects_required_fixed_profile_files() {
        let manifest = sample_manifest();
        let files = required_manifest_files(&manifest).expect("select files");
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].name, "PP-OCRv5_mobile_det.mnn");
        assert_eq!(files[3].name, "PP-LCNet_x1_0_doc_ori.mnn");
    }

    #[test]
    fn fails_when_manifest_missing_required_file() {
        let mut manifest = sample_manifest();
        manifest.files.pop();
        let err = required_manifest_files(&manifest).expect_err("missing file should fail");
        assert!(err.to_string().contains("missing required files"));
    }

    #[test]
    fn builds_candidate_urls_for_known_mirrors_and_release_assets() {
        let file = OcrManifestFile {
            name: "PP-OCRv5_mobile_rec.mnn".to_string(),
            size: 1,
            sha256: "00".to_string(),
            url: "https://gitee.com/winriseF/models/raw/master/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string(),
            mirrors: vec![],
        };

        let urls = candidate_download_urls(&file, "WinriseF/CtxRun", "ocr-models-20260410-b7141e7");

        assert_eq!(
            urls[0],
            "https://gitee.com/winriseF/models/raw/master/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn"
        );
        assert!(urls.contains(
            &"https://gcore.jsdelivr.net/gh/WinriseF/CtxRun@main/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string()
        ));
        assert!(urls.contains(
            &"https://cdn.jsdelivr.net/gh/WinriseF/CtxRun@main/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string()
        ));
        assert!(urls.contains(
            &"https://raw.githubusercontent.com/WinriseF/CtxRun/main/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string()
        ));
        assert!(urls.contains(
            &"https://github.com/WinriseF/CtxRun/releases/download/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string()
        ));
    }

    #[test]
    fn candidate_urls_are_deduplicated() {
        let file = OcrManifestFile {
            name: "PP-OCRv5_mobile_rec.mnn".to_string(),
            size: 1,
            sha256: "00".to_string(),
            url: "https://gitee.com/winriseF/models/raw/master/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string(),
            mirrors: vec![
                "https://cdn.jsdelivr.net/gh/WinriseF/CtxRun@main/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string(),
                "https://cdn.jsdelivr.net/gh/WinriseF/CtxRun@main/models/ocr/releases/ocr-models-20260410-b7141e7/PP-OCRv5_mobile_rec.mnn".to_string(),
            ],
        };

        let urls = candidate_download_urls(&file, "WinriseF/CtxRun", "ocr-models-20260410-b7141e7");

        assert_eq!(
            urls.iter()
                .filter(|url| url.contains("cdn.jsdelivr.net"))
                .count(),
            1
        );
    }
}
