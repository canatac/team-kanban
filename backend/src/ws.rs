use std::collections::HashMap;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::projects::require_member;
use crate::state::AppState;

pub async fn ws_handler(
    user: AuthUser,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, AppError> {
    let project_id = params
        .get("projectId")
        .ok_or_else(|| AppError::BadRequest("paramètre projectId requis".to_string()))?;
    let project_id = Uuid::parse_str(project_id)
        .map_err(|_| AppError::BadRequest("projectId invalide".to_string()))?;
    require_member(&state.pool, user.user_id, project_id).await?;
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, user.user_id, project_id)))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: Uuid, project_id: Uuid) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.events.subscribe();
    let project_str = project_id.to_string();
    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Ok(value) => {
                        if value.get("project").and_then(serde_json::Value::as_str) != Some(project_str.as_str()) {
                            continue;
                        }
                        // Ferme la connexion si l'utilisateur a été retiré du projet.
                        if value.get("type").and_then(serde_json::Value::as_str) == Some("members.updated")
                            && require_member(&state.pool, user_id, project_id).await.is_err()
                        {
                            break;
                        }
                        if sender.send(Message::Text(value.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            message = receiver.next() => {
                match message {
                    None | Some(Ok(Message::Close(_))) => break,
                    _ => {}
                }
            }
        }
    }
    let _ = sender.close().await;
}
