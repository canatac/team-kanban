use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::events::publish;
use crate::models::{Column, CommentWithAuthor, Task, TaskWithComments};
use crate::projects::require_member;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/:project_id/tasks", post(create))
        .route("/api/tasks/:id", get(get_task).patch(update).delete(remove))
}

pub async fn get_task_row(state: &AppState, id: Uuid) -> Result<Task, AppError> {
    sqlx::query_as(
        "SELECT id, project_id, column_id, title, description, position, assignee_id, created_by, created_at, updated_at FROM tasks WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| AppError::NotFound)
}

#[derive(Deserialize)]
struct CreateTask {
    column_id: Uuid,
    title: String,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateTask>,
) -> Result<Json<Task>, AppError> {
    require_member(&state.pool, user.user_id, project_id).await?;
    let title = body.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::BadRequest("le titre de la tâche est requis".to_string()));
    }
    let column: Column =
        sqlx::query_as("SELECT id, project_id, name, position, created_at FROM columns WHERE id = $1")
            .bind(body.column_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| AppError::BadRequest("colonne inconnue".to_string()))?;
    if column.project_id != project_id {
        return Err(AppError::BadRequest("colonne hors projet".to_string()));
    }
    let row: (Option<f64>,) = sqlx::query_as("SELECT MAX(position) FROM tasks WHERE column_id = $1")
        .bind(body.column_id)
        .fetch_one(&state.pool)
        .await?;
    let position = row.0.unwrap_or(-1.0) + 1.0;
    let task: Task = sqlx::query_as("INSERT INTO tasks (project_id, column_id, title, description, position, created_by) VALUES ($1, $2, $3, NULL, $4, $5) RETURNING id, project_id, column_id, title, description, position, assignee_id, created_by, created_at, updated_at")
        .bind(project_id)
        .bind(body.column_id)
        .bind(&title)
        .bind(position)
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;
    publish(
        &state,
        &project_id,
        "task.created",
        serde_json::to_value(&task).unwrap_or(serde_json::Value::Null),
    );
    Ok(Json(task))
}

async fn get_task(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskWithComments>, AppError> {
    let task = get_task_row(&state, id).await?;
    require_member(&state.pool, user.user_id, task.project_id).await?;
    let comments: Vec<CommentWithAuthor> = sqlx::query_as(
        "SELECT c.id, c.task_id, c.author_id, c.body, c.created_at, u.login AS author_login, u.avatar_url AS author_avatar FROM comments c JOIN users u ON u.id = c.author_id WHERE c.task_id = $1 ORDER BY c.created_at",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(TaskWithComments { task, comments }))
}

#[derive(Deserialize)]
struct UpdateTask {
    title: Option<String>,
    description: Option<String>,
    column_id: Uuid,
    position: f64,
    assignee_id: Option<Uuid>,
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateTask>,
) -> Result<Json<Task>, AppError> {
    let existing = get_task_row(&state, id).await?;
    require_member(&state.pool, user.user_id, existing.project_id).await?;

    let column: Option<(Uuid,)> =
        sqlx::query_as("SELECT project_id FROM columns WHERE id = $1")
            .bind(body.column_id)
            .fetch_optional(&state.pool)
            .await?;
    match column {
        Some((pid,)) if pid == existing.project_id => {}
        _ => return Err(AppError::BadRequest("colonne invalide".to_string())),
    }

    if let Some(assignee_id) = body.assignee_id {
        let member: Option<(Uuid,)> = sqlx::query_as(
            "SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = $2",
        )
        .bind(existing.project_id)
        .bind(assignee_id)
        .fetch_optional(&state.pool)
        .await?;
        if member.is_none() {
            return Err(AppError::BadRequest(
                "le membre assigné n'appartient pas au projet".to_string(),
            ));
        }
    }

    let title = match &body.title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => existing.title.clone(),
    };
    let task: Task = sqlx::query_as("UPDATE tasks SET title = $2, description = $3, column_id = $4, position = $5, assignee_id = $6, updated_at = now() WHERE id = $1 RETURNING id, project_id, column_id, title, description, position, assignee_id, created_by, created_at, updated_at")
        .bind(id)
        .bind(&title)
        .bind(&body.description)
        .bind(body.column_id)
        .bind(body.position)
        .bind(body.assignee_id)
        .fetch_one(&state.pool)
        .await?;
    publish(
        &state,
        &task.project_id,
        "task.updated",
        serde_json::to_value(&task).unwrap_or(serde_json::Value::Null),
    );
    Ok(Json(task))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let existing = get_task_row(&state, id).await?;
    require_member(&state.pool, user.user_id, existing.project_id).await?;
    sqlx::query("DELETE FROM tasks WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    publish(
        &state,
        &existing.project_id,
        "task.deleted",
        serde_json::json!({ "id": id.to_string() }),
    );
    Ok(StatusCode::NO_CONTENT)
}
