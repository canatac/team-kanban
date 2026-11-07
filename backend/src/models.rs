use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub github_id: i64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
pub struct UserLite {
    pub id: Uuid,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, FromRow)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub kind: String,
}

#[derive(Serialize, FromRow)]
pub struct Column {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub position: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid,
    pub column_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub position: f64,
    pub assignee_id: Option<Uuid>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub task_type: String,
    pub parent_task_id: Option<Uuid>,
    pub user_story: Option<String>,
    pub context: Option<String>,
    pub expected_results: sqlx::types::Json<Vec<String>>,
    pub acceptance_criteria: sqlx::types::Json<Vec<String>>,
    pub definition_of_done: sqlx::types::Json<Vec<String>>,
    pub technical_notes: Option<String>,
    pub story_points: Option<i32>,
    pub priority: Option<i32>,
}

#[derive(Serialize, FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub task_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
pub struct CommentWithAuthor {
    pub id: Uuid,
    pub task_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub author_login: String,
    pub author_avatar: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectDetail {
    pub project: Project,
    pub members: Vec<UserLite>,
    pub columns: Vec<Column>,
    pub tasks: Vec<Task>,
    pub ai_usage: AiUsage,
}

#[derive(Serialize, FromRow)]
pub struct AiUsage {
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cost_eur: f64,
}

#[derive(Serialize)]
pub struct TaskWithComments {
    pub task: Task,
    pub comments: Vec<CommentWithAuthor>,
    pub ai_usage: AiUsage,
}
