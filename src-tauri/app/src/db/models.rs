// 影子重定向：将所有对原有位置的引用导向新的 Crate
pub use ctxrun_model::prompt::*;
pub use ctxrun_model::common::*;

// 如果你之前有特定在 db 模块里的辅助逻辑，也可以放在这，
// 但 struct 定义现在统一从 ctxrun_model 拿。
