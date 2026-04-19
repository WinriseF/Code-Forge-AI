use std::collections::HashMap;
use std::sync::Arc;

use futures::future::BoxFuture;
use serde_json::Value;

use crate::fs_tools::{FsGrepFilesTool, FsListDirTool, FsReadFileTool};
use crate::miner_tools::{
    CrawlManager, MinerExtractSinglePageTool, MinerGetCrawlStatusTool, MinerSearchWebTool,
    MinerStartCrawlTool, MinerStopCrawlTool,
};
use crate::models::{ToolAnnotations, ToolCallRequest, ToolCallResponse, ToolSpec};

#[derive(Debug, Clone, Copy)]
pub(crate) enum ApprovalPolicy {
    Never,
    OnRequest,
}

impl ApprovalPolicy {
    fn from_env() -> Self {
        match std::env::var("CTXRUN_TOOL_APPROVAL")
            .ok()
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref()
        {
            Some("never") => ApprovalPolicy::Never,
            _ => ApprovalPolicy::OnRequest,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) enum ApprovalRequirement {
    Skip,
    NeedsApproval { reason: String },
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ToolExecutionContext;

#[derive(Debug, thiserror::Error)]
pub(crate) enum ToolRuntimeError {
    #[error("invalid arguments: {0}")]
    InvalidArguments(String),
    #[error("sandbox denied: {0}")]
    SandboxDenied(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Message(String),
}

impl From<serde_json::Error> for ToolRuntimeError {
    fn from(value: serde_json::Error) -> Self {
        ToolRuntimeError::InvalidArguments(value.to_string())
    }
}

impl From<&str> for ToolRuntimeError {
    fn from(value: &str) -> Self {
        ToolRuntimeError::Message(value.to_string())
    }
}

impl From<String> for ToolRuntimeError {
    fn from(value: String) -> Self {
        ToolRuntimeError::Message(value)
    }
}

pub(crate) trait ToolHandler: Send + Sync {
    fn spec(&self) -> ToolSpec;

    fn approval_requirement(
        &self,
        _arguments: &Value,
    ) -> Result<ApprovalRequirement, ToolRuntimeError> {
        let annotations = self.spec().annotations;
        default_approval_requirement(&annotations)
    }

    fn call<'a>(
        &'a self,
        arguments: Value,
        context: ToolExecutionContext,
    ) -> BoxFuture<'a, Result<Value, ToolRuntimeError>>;
}

fn default_approval_requirement(
    annotations: &ToolAnnotations,
) -> Result<ApprovalRequirement, ToolRuntimeError> {
    if annotations.destructive_hint {
        return Ok(ApprovalRequirement::NeedsApproval {
            reason: "Destructive operation requires explicit approval.".to_string(),
        });
    }
    if !annotations.read_only_hint {
        return Ok(ApprovalRequirement::NeedsApproval {
            reason: "Mutating operation requires explicit approval.".to_string(),
        });
    }
    Ok(ApprovalRequirement::Skip)
}

#[derive(Default)]
pub(crate) struct ToolRegistry {
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
    specs: Vec<ToolSpec>,
}

impl ToolRegistry {
    fn new() -> Self {
        Self::default()
    }

    fn register<T>(&mut self, handler: T)
    where
        T: ToolHandler + 'static,
    {
        let spec = handler.spec();
        let name = spec.name.clone();
        self.specs.push(spec);
        self.handlers.insert(name, Arc::new(handler));
    }

    fn specs(&self) -> Vec<ToolSpec> {
        let mut specs = self.specs.clone();
        specs.sort_by(|lhs, rhs| lhs.name.cmp(&rhs.name));
        specs
    }

    fn handler(&self, name: &str) -> Option<Arc<dyn ToolHandler>> {
        self.handlers.get(name).map(Arc::clone)
    }
}

struct ToolOrchestrator {
    registry: ToolRegistry,
    approval_policy: ApprovalPolicy,
}

impl ToolOrchestrator {
    fn new(registry: ToolRegistry, approval_policy: ApprovalPolicy) -> Self {
        Self {
            registry,
            approval_policy,
        }
    }

    fn list_tools(&self) -> Vec<ToolSpec> {
        self.registry.specs()
    }

    async fn call_tool(&self, request: ToolCallRequest) -> ToolCallResponse {
        let Some(handler) = self.registry.handler(&request.name) else {
            return ToolCallResponse::not_found(format!("Unknown tool '{}'.", request.name));
        };

        let requirement = match handler.approval_requirement(&request.arguments) {
            Ok(requirement) => requirement,
            Err(err) => return ToolCallResponse::error(err.to_string()),
        };

        match requirement {
            ApprovalRequirement::Skip => {}
            ApprovalRequirement::NeedsApproval { reason } => {
                if matches!(self.approval_policy, ApprovalPolicy::OnRequest) && !request.approved {
                    return ToolCallResponse::approval_required(reason);
                }
            }
        }

        let context = ToolExecutionContext;
        match handler.call(request.arguments, context).await {
            Ok(data) => ToolCallResponse::ok(data),
            Err(err) => ToolCallResponse::error(err.to_string()),
        }
    }
}

#[derive(Clone)]
pub struct ToolRuntime {
    orchestrator: Arc<ToolOrchestrator>,
}

impl ToolRuntime {
    pub fn new() -> Self {
        let mut registry = ToolRegistry::new();
        let crawl_manager = CrawlManager::default();

        registry.register(FsReadFileTool::new("read_file", "Read File"));
        registry.register(FsReadFileTool::new("fs.read_file", "Read File"));
        registry.register(FsListDirTool::new("list_dir", "List Directory"));
        registry.register(FsListDirTool::new("fs.list_directory", "List Directory"));
        registry.register(FsGrepFilesTool::new("grep_files", "Grep Files"));
        registry.register(FsGrepFilesTool::new("fs.search_files", "Search Files"));

        registry.register(MinerExtractSinglePageTool);
        registry.register(MinerSearchWebTool);
        registry.register(MinerStartCrawlTool::new(crawl_manager.clone()));
        registry.register(MinerGetCrawlStatusTool::new(crawl_manager.clone()));
        registry.register(MinerStopCrawlTool::new(crawl_manager));

        let orchestrator = ToolOrchestrator::new(registry, ApprovalPolicy::from_env());
        Self {
            orchestrator: Arc::new(orchestrator),
        }
    }

    pub fn list_tools(&self) -> Vec<ToolSpec> {
        self.orchestrator.list_tools()
    }

    pub async fn call_tool(&self, request: ToolCallRequest) -> ToolCallResponse {
        self.orchestrator.call_tool(request).await
    }
}

impl Default for ToolRuntime {
    fn default() -> Self {
        Self::new()
    }
}
