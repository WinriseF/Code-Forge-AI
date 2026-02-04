use serde::Serialize;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use sysinfo::{
    Pid, ProcessesToUpdate, ProcessRefreshKind, RefreshKind, CpuRefreshKind, MemoryRefreshKind,
    System, UpdateKind
};
use tauri::State;
use listeners::{get_all, Protocol};
use rayon::prelude::*;

#[cfg(target_os = "windows")]
use walkdir::WalkDir;
use crate::env_probe::{self, EnvReport, AiContextReport};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS, WIN32_ERROR};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{OpenProcess, IsProcessCritical, PROCESS_QUERY_LIMITED_INFORMATION};
#[cfg(target_os = "windows")]
use windows::Win32::System::RestartManager::{
    RmStartSession, RmRegisterResources, RmGetList, RmEndSession, 
    RM_PROCESS_INFO, CCH_RM_SESSION_KEY
};
#[cfg(target_os = "windows")]
use windows::core::{PWSTR, PCWSTR, BOOL};

#[derive(Debug, Serialize, Clone)]
pub struct SystemMetrics {
    pub cpu_usage: f32,
    pub memory_used: u64,
    pub memory_total: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory: u64,
    pub user: String,
    pub is_system: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub pid: u32,
    pub process_name: String,
    pub local_addr: String,
    pub is_system: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct NetDiagResult {
    pub id: String,
    pub name: String,
    pub url: String,
    pub status: String,
    pub latency: u128,
    pub status_code: u16,
}

#[derive(Debug, Serialize, Clone)]
pub struct LockedFileProcess {
    pub pid: u32,
    pub name: String,
    pub icon: Option<String>,
    pub user: String,
    pub is_system: bool,
}

fn is_critical_system_process(_sys: &System, process: &sysinfo::Process) -> bool {
    let pid = process.pid().as_u32();

    if pid <= 4 { return true; }

    #[cfg(target_os = "windows")]
    {
        // Windows API check
        unsafe {
            match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) { Ok(handle) => {
                if !handle.is_invalid() {
                    let mut is_critical = BOOL(0);
                    if IsProcessCritical(handle, &mut is_critical).is_ok() && bool::from(is_critical) {
                        let _ = windows::Win32::Foundation::CloseHandle(handle);
                        return true;
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(handle);
                } else {
                    return true;
                }
            } _ => {
                return true;
            }}
        }

        // Additional list
        let name = process.name().to_string_lossy().to_lowercase();
        if ["csrss.exe", "smss.exe", "wininit.exe", "services.exe", "lsass.exe", "memory compression", "spoolsv.exe"].contains(&name.as_str()) {
            return true;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = _sys;
        if let Some(uid) = process.user_id() {
            if uid.to_string() == "0" {
                return true;
            }
        }
    }

    false
}

#[tauri::command]
pub fn get_system_metrics(system: State<'_, Arc<Mutex<System>>>) -> Result<SystemMetrics, String> {
    let mut sys = system.lock().map_err(|e| e.to_string())?;

    sys.refresh_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    Ok(SystemMetrics {
        cpu_usage: sys.global_cpu_usage(),
        memory_used: sys.used_memory(),
        memory_total: sys.total_memory(),
    })
}

#[tauri::command]
pub fn get_top_processes(system: State<'_, Arc<Mutex<System>>>) -> Result<Vec<ProcessInfo>, String> {
    let mut sys = system.lock().map_err(|e| e.to_string())?;

    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_user(UpdateKind::Always),
    );

    let mut processes: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let pid_u32 = pid.as_u32();
            if pid_u32 == 0 { return None; }

            let name = process.name().to_string_lossy().to_string();
            if name.is_empty() { return None; }

            let user = process.user_id()
                .map(|uid| uid.to_string().replace("Uid(", "").replace(")", ""))
                .unwrap_or_else(|| "Unknown".to_string());

            Some(ProcessInfo {
                pid: pid_u32,
                name,
                cpu_usage: process.cpu_usage(),
                memory: process.memory(),
                user,
                is_system: is_critical_system_process(&sys, process),
            })
        })
        .collect();

    processes.par_sort_unstable_by(|a, b| b.memory.partial_cmp(&a.memory).unwrap_or(std::cmp::Ordering::Equal));

    Ok(processes.into_iter().take(30).collect())
}

#[tauri::command]
pub async fn get_active_ports(system: State<'_, Arc<Mutex<System>>>) -> Result<Vec<PortInfo>, String> {
    let sys_state = system.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let listeners = get_all().map_err(|e| e.to_string())?;
        let mut sys = sys_state.lock().map_err(|e| e.to_string())?;

        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_user(UpdateKind::Always),
        );

        let mut port_infos = Vec::new();

        for l in listeners {
            let pid_u32 = l.process.pid;
            let pid = Pid::from(pid_u32 as usize);

            let (process_name, is_system) = if let Some(process) = sys.process(pid) {
                (process.name().to_string_lossy().to_string(), is_critical_system_process(&sys, process))
            } else {
                (format!("Unknown ({})", pid_u32), false)
            };

            let local_addr = match l.socket {
                SocketAddr::V4(v4) => v4.ip().to_string(),
                SocketAddr::V6(v6) => v6.ip().to_string(),
            };

            port_infos.push(PortInfo {
                port: l.socket.port(),
                protocol: match l.protocol {
                    Protocol::TCP => "TCP".to_string(),
                    Protocol::UDP => "UDP".to_string(),
                },
                pid: pid_u32,
                process_name,
                local_addr,
                is_system,
            });
        }

        port_infos.sort_by_key(|p| p.port);
        port_infos.dedup_by(|a, b| a.port == b.port && a.protocol == b.protocol);

        Ok(port_infos)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn kill_process(pid: u32, system: State<'_, Arc<Mutex<System>>>) -> Result<String, String> {
    let mut sys = system.lock().map_err(|e| e.to_string())?;
    let sys_pid = Pid::from(pid as usize);

    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[sys_pid]),
        false,
        ProcessRefreshKind::nothing(),
    );

    if let Some(process) = sys.process(sys_pid) {
        if is_critical_system_process(&sys, process) {
            return Err("Action Denied: Cannot kill a critical system process.".to_string());
        }
    } else {
        return Err("Process not found".to_string());
    }

    #[cfg(target_os = "windows")]
    let output = Command::new("taskkill").args(&["/F", "/PID", &pid.to_string()]).output();
    
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("kill").args(&["-9", &pid.to_string()]).output();

    match output {
        Ok(o) if o.status.success() => Ok("Success".to_string()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn check_file_locks(path: String, system: State<'_, Arc<Mutex<System>>>) -> Result<Vec<LockedFileProcess>, String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("Path does not exist".to_string());
    }

    let is_dir = path_obj.is_dir();
    let mut locking_pids = HashSet::new();

    #[cfg(target_os = "windows")]
    {
        let mut paths_to_check = Vec::new();

        if is_dir {
            for entry in WalkDir::new(&path).min_depth(1).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    paths_to_check.push(entry.path().to_string_lossy().to_string());
                }
            }
            paths_to_check.push(path.clone());
        } else {
            paths_to_check.push(path.clone());
        }

        let str_refs: Vec<&str> = paths_to_check.iter().map(|s| s.as_str()).collect();
        for chunk in str_refs.chunks(50) {
            if let Ok(pids) = get_locking_pids_windows(chunk) {
                for pid in pids {
                    locking_pids.insert(pid);
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("lsof");

        if is_dir {
            cmd.arg("+D");
        }

        cmd.arg(&path);

        let output = cmd.output().map_err(|e| format!("Failed to run lsof: {}", e))?;

        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            for line in out_str.lines() {
                if let Ok(pid) = line.trim().parse::<u32>() {
                    locking_pids.insert(pid);
                }
            }
        }
    }

    let mut sys = system.lock().map_err(|e| e.to_string())?;

    let pids_to_refresh: Vec<Pid> = locking_pids.iter().map(|&p| Pid::from(p as usize)).collect();

    if pids_to_refresh.is_empty() {
        return Ok(Vec::new());
    }

    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids_to_refresh),
        false,
        ProcessRefreshKind::nothing().with_user(UpdateKind::Always),
    );

    let mut results = Vec::new();
    for pid_u32 in locking_pids {
        let sys_pid = Pid::from(pid_u32 as usize);
        if let Some(proc) = sys.process(sys_pid) {
            let user = proc.user_id()
                .map(|uid| uid.to_string().replace("Uid(", "").replace(")", ""))
                .unwrap_or_else(|| "Unknown".to_string());

            results.push(LockedFileProcess {
                pid: pid_u32,
                name: proc.name().to_string_lossy().to_string(),
                icon: None,
                user,
                is_system: is_critical_system_process(&sys, proc),
            });
        }
    }

    Ok(results)
}

#[cfg(target_os = "windows")]
fn get_locking_pids_windows(path_strs: &[&str]) -> Result<Vec<u32>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    unsafe {
        let mut session_handle: u32 = 0;
        let mut session_key = [0u16; (CCH_RM_SESSION_KEY + 1) as usize];

        let res = RmStartSession(&mut session_handle, Some(0u32), PWSTR(session_key.as_mut_ptr()));
        if res != ERROR_SUCCESS {
            return Err(format!("RmStartSession failed: {:?}", res));
        }

        struct SessionGuard(u32);
        impl Drop for SessionGuard {
            fn drop(&mut self) {
                unsafe { let _ = RmEndSession(self.0); }
            }
        }
        let _guard = SessionGuard(session_handle);

        // Prepare path array
        let wide_paths_storage: Vec<Vec<u16>> = path_strs.iter()
            .map(|s| OsStr::new(s).encode_wide().chain(Some(0)).collect())
            .collect();

        let paths_ptrs: Vec<PCWSTR> = wide_paths_storage.iter()
            .map(|w| PCWSTR(w.as_ptr()))
            .collect();

        // Register resources
        let res = RmRegisterResources(
            session_handle,
            Some(&paths_ptrs),
            None,
            None
        );

        if res != ERROR_SUCCESS {
            return Err(format!("RmRegisterResources failed: {:?}", res));
        }

        // Get list of locking processes
        let mut proc_info_needed = 0u32;
        let mut proc_info: [RM_PROCESS_INFO; 10] = std::mem::zeroed();
        let mut reboot_reasons = 0u32;

        let res = RmGetList(
            session_handle,
            &mut proc_info_needed,
            &mut proc_info_needed,
            Some(proc_info.as_mut_ptr()),
            &mut reboot_reasons
        );

        if res == ERROR_MORE_DATA {
            let mut vec_info = vec![std::mem::zeroed::<RM_PROCESS_INFO>(); proc_info_needed as usize];
            let mut count = proc_info_needed;
            let res2 = RmGetList(
                session_handle,
                &mut proc_info_needed,
                &mut count,
                Some(vec_info.as_mut_ptr()),
                &mut reboot_reasons
            );
            if res2 != ERROR_SUCCESS {
                return Err(format!("RmGetList retry failed: {:?}", res2));
            }
            return Ok(vec_info.into_iter().map(|p| p.Process.dwProcessId).collect());
        }

        if res != ERROR_SUCCESS {
            if res == WIN32_ERROR(0) {
                // No processes locking the file
                let count = proc_info_needed as usize;
                return Ok(proc_info[..count].iter().map(|p| p.Process.dwProcessId).collect());
            }
            return Err(format!("RmGetList failed: {:?}", res));
        }

        let count = proc_info_needed as usize;
        Ok(proc_info[..count].iter().map(|p| p.Process.dwProcessId).collect())
    }
}

#[tauri::command]
pub async fn get_env_info(
    system: State<'_, Arc<Mutex<System>>>,
    project_path: Option<String>,
) -> Result<EnvReport, String> {
    let (
        system_info, 
        (binaries, (browsers, (ides, (languages, (virtualization, (utilities, (managers, (npm_packages, (databases, sdks)))))))))
    ) = rayon::join(
        || env_probe::system::probe_system(system.clone()),
        || rayon::join(
            || env_probe::binaries::probe_by_category("Binaries"),
            || rayon::join(
                || env_probe::browsers::probe_browsers(),
                || rayon::join(
                    || env_probe::ides::probe_ides(),
                    || rayon::join(
                        || env_probe::binaries::probe_by_category("Languages"),
                        || rayon::join(
                            || env_probe::binaries::probe_by_category("Virtualization"),
                            || rayon::join(
                                || env_probe::binaries::probe_by_category("Utilities"),
                                || rayon::join(
                                    || env_probe::binaries::probe_by_category("Managers"),
                                    || rayon::join(
                                        || env_probe::npm::probe_npm_packages(project_path.clone()),
                                        || rayon::join(
                                            || env_probe::binaries::probe_by_category("Databases"),
                                            || env_probe::sdks::probe_sdks() 
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            )
        )
    );

    Ok(EnvReport {
        system: Some(system_info),
        binaries,
        browsers,
        ides,
        languages,
        virtualization,
        utilities,
        managers,
        npm_packages,
        sdks,
        databases,
    })
}

#[tauri::command]
pub async fn get_ai_context(
    project_path: String,
) -> Result<AiContextReport, String> {
    let report = tauri::async_runtime::spawn_blocking(move || {
        env_probe::scan_logic::scan_ai_context(&project_path)
    }).await.map_err(|e| e.to_string())?;

    Ok(report)
}

#[tauri::command]
pub async fn diagnose_network() -> Vec<NetDiagResult> {
    let targets = vec![
        ("github", "GitHub", "https://github.com"),
        ("google", "Google", "https://www.google.com"),
        ("openai", "OpenAI Status", "https://status.openai.com"),
        ("pypi", "PyPI", "https://pypi.org"),
        ("npm", "NPM Registry", "https://registry.npmjs.org"),
        ("baidu", "Baidu", "https://www.baidu.com"),
        ("cloudflare", "Cloudflare", "https://www.cloudflare.com"),
    ];

    let target_order: Vec<String> = targets.iter().map(|t| t.0.to_string()).collect();

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .unwrap_or_default();

    let mut handles = Vec::new();

    for (id, name, url) in targets {
        let c = client.clone();
        let id = id.to_string();
        let name = name.to_string();
        let url = url.to_string();

        handles.push(tauri::async_runtime::spawn(async move {
            let start = std::time::Instant::now();
            
            let resp = c.head(&url).send().await;
            let duration = start.elapsed().as_millis();

            match resp {
                Ok(r) => {
                    let status_code = r.status().as_u16();
                    let status = if status_code >= 200 && status_code < 400 {
                        if duration < 500 { "Success" } else { "Slow" }
                    } else if status_code == 403 || status_code == 401 {
                        if duration < 500 { "Success" } else { "Slow" }
                    } else {
                        "Fail"
                    };
                    NetDiagResult { id, name, url, status: status.to_string(), latency: duration, status_code }
                }
                Err(_) => {
                    let start_retry = std::time::Instant::now();
                    match c.get(&url).send().await {
                        Ok(r) => {
                            let duration_retry = start_retry.elapsed().as_millis();
                            let status_code = r.status().as_u16();
                            let status = if status_code >= 200 && status_code < 400 {
                                if duration_retry < 800 { "Success" } else { "Slow" }
                            } else {
                                "Fail"
                            };
                            NetDiagResult { id, name, url, status: status.to_string(), latency: duration_retry, status_code }
                        }
                        Err(_) => NetDiagResult { id, name, url, status: "Fail".to_string(), latency: 0, status_code: 0 },
                    }
                }
            }
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        let res = handle.await;
        if let Ok(result) = res {
            results.push(result);
        }
    }

    let mut ordered_results = Vec::new();
    for id in target_order {
        if let Some(r) = results.iter().find(|r| r.id == id) {
            ordered_results.push(r.clone());
        }
    }

    ordered_results
}