use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tauri::State;

pub fn probe_system(system_state: State<'_, Arc<Mutex<System>>>) -> HashMap<String, String> {
    let mut info = HashMap::new();
    
    let mut sys = system_state.lock().unwrap();
    sys.refresh_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    let os_name = System::name().unwrap_or_else(|| "Unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
    info.insert("OS".to_string(), format!("{} {}", os_name, os_version));

    let cpu_brand = sys.cpus().first().map(|cpu| cpu.brand().trim().to_string()).unwrap_or_else(|| "Unknown CPU".to_string());
    
    let logical_cores = sys.cpus().len();
    let physical_cores = System::physical_core_count().unwrap_or(logical_cores);
    
    let arch = std::env::consts::ARCH; 
    info.insert("CPU".to_string(), format!("({} cores) {} {}", physical_cores, arch, cpu_brand));

    let total_mem_gb = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let free_mem_gb = sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    info.insert("Memory".to_string(), format!("{:.2} GB / {:.2} GB", free_mem_gb, total_mem_gb));

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            let version = crate::env_probe::common::run_command(&shell, &["--version"])
                .unwrap_or_else(|_| "Unknown".to_string());
            let v_clean = crate::env_probe::common::find_version(&version, None);
            info.insert("Shell".to_string(), format!("{} - {}", shell, v_clean));
        }
    }

    info
}