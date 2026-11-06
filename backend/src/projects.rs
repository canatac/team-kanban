use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::events::publish;
use crate::models::{AiUsage, Column, Project, ProjectDetail, Task, UserLite};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects", get(list).post(create))
        .route("/api/projects/:id", get(detail))
        .route("/api/projects/:id/members", post(add_member))
        .route("/api/projects/:id/members/:user_id", delete(remove_member))
}

/// Vérifie que l'utilisateur est membre du projet, sinon 403.
pub async fn require_member(
    pool: &PgPool,
    user_id: Uuid,
    project_id: Uuid,
) -> Result<(), AppError> {
    let found: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = $2",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    if found.is_none() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn list(State(state): State<AppState>, user: AuthUser) -> Result<Json<Vec<Project>>, AppError> {
    let projects: Vec<Project> = sqlx::query_as(
        "SELECT p.id, p.name, p.owner_id, p.created_at FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.created_at DESC",
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(projects))
}

#[derive(Deserialize)]
struct CreateProject {
    name: String,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateProject>,
) -> Result<Json<Project>, AppError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("le nom du projet est requis".to_string()));
    }
    let mut tx = state.pool.begin().await?;
    let project: Project = sqlx::query_as(
        "INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id, created_at",
    )
    .bind(&name)
    .bind(user.user_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(project.id)
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;
    let default_columns = ["À faire", "En cours", "Terminé"];
    for (i, column_name) in default_columns.iter().enumerate() {
        sqlx::query("INSERT INTO columns (project_id, name, position) VALUES ($1, $2, $3)")
            .bind(project.id)
            .bind(column_name)
            .bind(i as f64)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(project))
}

async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ProjectDetail>, AppError> {
    require_member(&state.pool, user.user_id, project_id).await?;
    let project: Project = sqlx::query_as(
        "SELECT id, name, owner_id, created_at FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_one(&state.pool)
    .await?;
    let members: Vec<UserLite> = sqlx::query_as(
        "SELECT u.id, u.login, u.name, u.avatar_url FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.login",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    let columns: Vec<Column> = sqlx::query_as(
        "SELECT id, project_id, name, position, created_at FROM columns WHERE project_id = $1 ORDER BY position",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    let tasks: Vec<Task> = sqlx::query_as(
        &format!("{} FROM tasks WHERE project_id = $1 ORDER BY position", crate::tasks::TASK_COLUMNS),
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    let ai_usage: AiUsage = sqlx::query_as(
        "SELECT COALESCE(SUM(prompt_tokens), 0)::BIGINT AS prompt_tokens, COALESCE(SUM(completion_tokens), 0)::BIGINT AS completion_tokens, COALESCE(SUM(cost_eur), 0)::DOUBLE PRECISION AS cost_eur FROM ai_usage WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(ProjectDetail {
        project,
        members,
        columns,
        tasks,
        ai_usage,
    }))
}

#[derive(Deserialize)]
struct AddMember {
    login: String,
}

async fn add_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(body): Json<AddMember>,
) -> Result<Json<UserLite>, AppError> {
    require_member(&state.pool, user.user_id, project_id).await?;
    let target: UserLite = sqlx::query_as(
        "SELECT id, login, name, avatar_url FROM users WHERE lower(login) = lower($1)",
    )
    .bind(body.login.trim())
    .fetch_one(&state.pool)
    .await
    .map_err(|_| {
        AppError::BadRequest(
            "utilisateur inconnu (il doit s'être connecté au moins une fois)".to_string(),
        )
    })?;
    sqlx::query("INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(project_id)
        .bind(target.id)
        .execute(&state.pool)
        .await?;
    publish(
        &state,
        &project_id,
        "members.updated",
        serde_json::json!({ "user": target }),
    );
    Ok(Json(target))
}

async fn remove_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    // Seul le propriétaire peut retirer des membres.
    let requester: Option<(String,)> =
        sqlx::query_as("SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2")
            .bind(project_id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?;
    match requester.as_ref().map(|r| r.0.as_str()) {
        Some("owner") => {}
        _ => return Err(AppError::Forbidden),
    }
    let target: Option<(String,)> =
        sqlx::query_as("SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2")
            .bind(project_id)
            .bind(target_id)
            .fetch_optional(&state.pool)
            .await?;
    match target.as_ref().map(|r| r.0.as_str()) {
        Some("owner") => {
            return Err(AppError::BadRequest(
                "impossible de retirer le propriétaire du projet".to_string(),
            ))
        }
        Some(_) => {}
        None => return Err(AppError::NotFound),
    }
    sqlx::query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2")
        .bind(project_id)
        .bind(target_id)
        .execute(&state.pool)
        .await?;
    publish(&state, &project_id, "members.updated", serde_json::json!({}));
    Ok(StatusCode::NO_CONTENT)
}
