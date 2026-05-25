use std::collections::HashMap;
use std::fs;
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

pub mod browser;
pub mod commands;
pub mod engine;
pub mod error;
pub mod inspector;
pub mod models;
pub mod screen;

pub use error::{AutomatorError, Result};

use engine::AutomatorState;
use models::{AutomatorAction, AutomatorStoreRoot, Workflow, WorkflowGraph, WorkflowNode};

fn workflow_to_graph(workflow: &Workflow) -> Option<WorkflowGraph> {
    if workflow.flow_nodes.is_empty() || workflow.flow_edges.is_empty() {
        return None;
    }

    let start_node = workflow
        .flow_nodes
        .iter()
        .find(|n| n.node_type == "startNode")?;

    let start_edge = workflow
        .flow_edges
        .iter()
        .find(|e| e.source == start_node.id)?;

    let mut nodes_map: HashMap<String, WorkflowNode> = HashMap::new();

    for node in &workflow.flow_nodes {
        if node.node_type == "startNode" || node.node_type == "endNode" {
            continue;
        }

        let payload = node.data.get("payload")?.clone();
        let action_type = match node.node_type.as_str() {
            "conditionNode" => "CheckColor".to_string(),
            "iteratorNode" => "Iterate".to_string(),
            "launchBrowserNode" => "LaunchBrowser".to_string(),
            "actionNode" => node.data.get("actionType")?.as_str()?.to_string(),
            _ => continue,
        };

        let action_json = serde_json::json!({
            "type": action_type,
            "payload": payload
        });

        let action: AutomatorAction = match serde_json::from_value(action_json) {
            Ok(a) => a,
            Err(_) => continue,
        };

        let mut workflow_node = WorkflowNode {
            id: node.id.clone(),
            action: action.clone(),
            next_id: None,
            true_id: None,
            false_id: None,
        };

        let outgoing_edges = workflow.flow_edges.iter().filter(|e| e.source == node.id);

        let is_branch = matches!(
            action,
            AutomatorAction::CheckColor { .. } | AutomatorAction::Iterate { .. }
        );
        for edge in outgoing_edges {
            if is_branch {
                match edge.source_handle.as_deref() {
                    Some("true") => workflow_node.true_id = Some(edge.target.clone()),
                    Some("false") => workflow_node.false_id = Some(edge.target.clone()),
                    _ => {
                        if workflow_node.false_id.is_none() {
                            workflow_node.false_id = Some(edge.target.clone());
                        }
                    }
                }
            } else if workflow_node.next_id.is_none() {
                workflow_node.next_id = Some(edge.target.clone());
            }
        }

        nodes_map.insert(node.id.clone(), workflow_node);
    }

    if nodes_map.is_empty() {
        return None;
    }

    Some(WorkflowGraph {
        nodes: nodes_map,
        start_node_id: start_edge.target.clone(),
    })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("ctxrun-plugin-automator")
        .invoke_handler(tauri::generate_handler![
            commands::execute_workflow,
            commands::execute_workflow_graph,
            commands::stop_workflow,
            commands::get_mouse_position,
            commands::get_pixel_color,
            commands::get_element_under_cursor,
            commands::pick_web_selector,
            commands::pick_web_target
        ])
        .setup(|app, _api| {
            app.manage(AutomatorState::new());
            Ok(())
        })
        .build()
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AutomatorState>();

    if state.is_running.load(Ordering::SeqCst) {
        state.stop();
        let _ = app.emit("automator:status", false);
        return;
    }

    if let Ok(app_dir) = app.path().app_local_data_dir() {
        let config_path = app_dir.join("automator-config.json");

        if let Ok(content) = fs::read_to_string(config_path)
            && let Ok(store_data) = serde_json::from_str::<AutomatorStoreRoot>(&content)
        {
            let mut persisted = store_data.state;
            let selected_workflow = persisted
                .active_workflow
                .take()
                .or_else(|| {
                    persisted
                        .active_workflow_id
                        .as_deref()
                        .and_then(|active_id| {
                            persisted
                                .workflows
                                .iter()
                                .find(|w| w.id == active_id)
                                .cloned()
                        })
                })
                .or_else(|| persisted.workflows.first().cloned());

            if let Some(workflow) = selected_workflow {
                if !state.try_start() {
                    return;
                }
                let _ = app.emit("automator:status", true);

                if let Some(graph) = workflow_to_graph(&workflow) {
                    engine::run_graph_task(app.clone(), graph, state.is_running.clone());
                } else {
                    engine::run_workflow_task(app.clone(), workflow, state.is_running.clone());
                }
            }
        }
    }
}
