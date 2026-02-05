use serde::{Serialize, Deserialize};
use specta::Type;

#[derive(Debug, Serialize, Clone, Type)]
pub struct SystemMetrics {
    pub cpu_usage: f32,
    pub memory_used: u64,
    pub memory_total: u64,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory: u64,
    pub user: String,
    pub is_system: bool,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub pid: u32,
    pub process_name: String,
    pub local_addr: String,
    pub is_system: bool,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct NetDiagResult {
    pub id: String,
    pub name: String,
    pub url: String,
    pub status: String,
    pub latency: u128,
    pub status_code: u16,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct LockedFileProcess {
    pub pid: u32,
    pub name: String,
    pub icon: Option<String>,
    pub user: String,
    pub is_system: bool,
}
