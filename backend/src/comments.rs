use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, post};
use axum::{Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::events::publish;
use crate::models::Comment;
use crate::projects::require_member;
use crate::state::AppState;
use crate::tasks::get_task_row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/tasks/:task_id/comments", post(create))
        .route("/api/comments/:id", delete(remove))
}

#[derive(Deserialize)]
struct CreateComment {
    body: String,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(task_id): Path<Uuid>,
    Json(body): Json<CreateComment>,
) -> Result<Json<Comment>, AppError> {
    let text = body.body.trim().to_string();
    if text.is_empty() {
        return Err(AppError::BadRequest("commentaire vide".to_string()));
    }
    let task = get_task_row(&state, task_id).await?;
    require_member(&state.pool, user.user_id, task.project_id).await?;
    let comment: Comment = sqlx::query_as(
        "INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, task_id, author_id, body, created_at",
    )
    .bind(task_id)
    .bind(user.user_id)
    .bind(&text)
    .fetch_one(&state.pool)
    .await?;
    publish(
        &state,
        &task.project_id,
        "comment.created",
        serde_json::json!({ "task_id": task_id.to_string() }),
    );
    Ok(Json(comment))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let comment: Comment =
        sqlx::query_as("SELECT id, task_id, author_id, body, created_at FROM comments WHERE id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| AppError::NotFound)?;
    let task = get_task_row(&state, comment.task_id).await?;
    require_member(&state.pool, user.user_id, task.project_id).await?;
    sqlx::query("DELETE FROM comments WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    publish(
        &state,
        &task.project_id,
        "comment.deleted",
        serde_json::json!({ "task_id": task.task_id.to_string() }),
    );
    Ok(StatusCode::NO_CONTENT)
}
