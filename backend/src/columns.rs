use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::events::publish;
use crate::models::Column;
use crate::projects::require_member;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/:project_id/columns", post(create))
        .route("/api/columns/:id", patch(rename).delete(remove))
}

async fn get_column(state: &AppState, id: Uuid) -> Result<Column, AppError> {
    sqlx::query_as("SELECT id, project_id, name, position, created_at FROM columns WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::NotFound)
}

#[derive(Deserialize)]
struct ColumnBody {
    name: String,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(body): Json<ColumnBody>,
) -> Result<Json<Column>, AppError> {
    require_member(&state.pool, user.user_id, project_id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("le nom de la colonne est requis".to_string()));
    }
    let row: (Option<f64>,) =
        sqlx::query_as("SELECT MAX(position) FROM columns WHERE project_id = $1")
            .bind(project_id)
            .fetch_one(&state.pool)
            .await?;
    let position = row.0.unwrap_or(-1.0) + 1.0;
    let column: Column = sqlx::query_as(
        "INSERT INTO columns (project_id, name, position) VALUES ($1, $2, $3) RETURNING id, project_id, name, position, created_at",
    )
    .bind(project_id)
    .bind(&name)
    .bind(position)
    .fetch_one(&state.pool)
    .await?;
    publish(
        &state,
        &project_id,
        "column.created",
        serde_json::to_value(&column).unwrap_or(serde_json::Value::Null),
    );
    Ok(Json(column))
}

async fn rename(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ColumnBody>,
) -> Result<Json<Column>, AppError> {
    let existing = get_column(&state, id).await?;
    require_member(&state.pool, user.user_id, existing.project_id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("le nom de la colonne est requis".to_string()));
    }
    let column: Column = sqlx::query_as(
        "UPDATE columns SET name = $2 WHERE id = $1 RETURNING id, project_id, name, position, created_at",
    )
    .bind(id)
    .bind(&name)
    .fetch_one(&state.pool)
    .await?;
    publish(
        &state,
        &column.project_id,
        "column.updated",
        serde_json::to_value(&column).unwrap_or(serde_json::Value::Null),
    );
    Ok(Json(column))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let existing = get_column(&state, id).await?;
    require_member(&state.pool, user.user_id, existing.project_id).await?;
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE column_id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if count.0 > 0 {
        return Err(AppError::BadRequest(
            "colonne non vide : déplacez ou supprimez ses tâches d'abord".to_string(),
        ));
    }
    sqlx::query("DELETE FROM columns WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    publish(
        &state,
        &existing.project_id,
        "column.deleted",
        serde_json::json!({ "id": id.to_string() }),
    );
    Ok(StatusCode::NO_CONTENT)
}
