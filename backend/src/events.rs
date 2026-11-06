use serde_json::{json, Value};
use uuid::Uuid;

use crate::state::AppState;

/// Diffuse un événement temps réel à tous les clients WebSocket abonnés au projet.
pub fn publish(state: &AppState, project_id: &Uuid, kind: &str, data: Value) {
    let _ = state.events.send(json!({
        "project": project_id.to_string(),
        "type": kind,
        "data": data,
    }));
}
