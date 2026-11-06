use std::collections::HashMap;
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::routing::post;
use axum::{Json, Router};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::events::publish;
use crate::models::{Column, Task};
use crate::projects::require_member;
use crate::state::AppState;

const MODEL: &str = "mistral-small-latest";
const MAX_FILES: usize = 5;
const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
const MAX_BODY_BYTES: usize = 30 * 1024 * 1024;
const MAX_TASKS: usize = 25;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/:project_id/generate", post(generate))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

#[derive(Serialize)]
struct GenerationSummary {
    columns_created: usize,
    tasks_created: usize,
}

#[derive(Deserialize)]
struct AiPlan {
    #[serde(default)]
    new_columns: Vec<String>,
    #[serde(default)]
    tasks: Vec<AiTask>,
}

#[derive(Deserialize)]
struct AiTask {
    column: String,
    title: String,
    description: Option<String>,
}

async fn generate(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<GenerationSummary>, AppError> {
    require_member(&state.pool, user.user_id, project_id).await?;
    let api_key = state
        .cfg
        .mistral_api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest("la génération IA n'est pas configurée (MISTRAL_API_KEY absent)".to_string())
        })?;

    // 1. Lecture du formulaire : prompt + fichiers joints.
    let mut prompt: Option<String> = None;
    let mut file_parts: Vec<serde_json::Value> = Vec::new();
    let mut file_count = 0usize;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("formulaire invalide : {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "prompt" => {
                prompt = Some(field.text().await.unwrap_or_default());
            }
            "files" => {
                file_count += 1;
                if file_count > MAX_FILES {
                    return Err(AppError::BadRequest(format!(
                        "trop de fichiers (max {MAX_FILES})"
                    )));
                }
                let file_name = field.file_name().unwrap_or("fichier").to_string();
                let content_type = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("lecture du fichier impossible : {e}")))?;
                if data.len() > MAX_FILE_BYTES {
                    return Err(AppError::BadRequest(format!(
                        "{file_name} est trop volumineux (max 10 Mo)"
                    )));
                }
                file_parts.push(file_to_message(&file_name, &content_type, &data)?);
            }
            _ => {}
        }
    }

    let prompt = prompt
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::BadRequest("le prompt est requis".to_string()))?;

    // 2. Colonnes existantes du projet.
    let columns: Vec<Column> = sqlx::query_as(
        "SELECT id, project_id, name, position, created_at FROM columns WHERE project_id = $1 ORDER BY position",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    let column_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();

    // 3. Appel à l'API Mistral.
    let system = format!(
        "Tu es l'assistant projet d'un tableau Kanban. À partir du brief de l'utilisateur (et des éventuels fichiers joints), \
tu proposes des tickets de travail prêts à être placés dans le tableau.\n\
Colonnes existantes du tableau : [{}].\n\
Réponds STRICTEMENT en JSON, sans aucun texte autour, au format :\n\
{{\"new_columns\": [\"Nom de colonne\", ...], \"tasks\": [{{\"column\": \"Nom de colonne\", \"title\": \"titre court\", \"description\": \"description\"}}, ...]}}\n\
Règles :\n\
- Place les tickets dans les colonnes existantes quand c'est pertinent (reprends leur nom exact, dans \"column\").\n\
- Si le brief le justifie, propose de nouvelles colonnes dans \"new_columns\" (elles seront créées avant les tickets) ; place alors certains tickets dans ces nouvelles colonnes. Sinon laisse \"new_columns\" vide.\n\
- Génère entre 3 et 15 tickets, couvrant concrètement le brief ; saute les tickets trop vagues.\n\
- Titres courts (moins de 80 caractères, pas de verbes à l'infinitif superflu).\n\
- Descriptions actionnables, 1 à 3 phrases, sans markdown.\n\
- \"column\" doit toujours exister dans les colonnes existantes ou dans \"new_columns\".",
        column_names.join(", ")
    );

    let mut user_content: Vec<serde_json::Value> =
        vec![serde_json::json!({ "type": "text", "text": prompt })];
    user_content.extend(file_parts);

    let request_body = serde_json::json!({
        "model": MODEL,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_content },
        ],
        "temperature": 0.2,
        "max_tokens": 4000,
        "response_format": { "type": "json_object" },
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("client HTTP indisponible : {e}")))?;

    let response = client
        .post("https://api.mistral.ai/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("appel de l'API Mistral impossible : {e}")))?;

    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("réponse Mistral illisible : {e}")))?;
    if !status.is_success() {
        let message = payload
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("erreur inconnue");
        return Err(AppError::Internal(format!("API Mistral ({status}) : {message}")));
    }

    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .ok_or_else(|| AppError::Internal("réponse Mistral inattendue".to_string()))?;
    let plan: AiPlan = serde_json::from_str(content)
        .map_err(|e| AppError::Internal(format!("réponse IA non exploitable : {e}")))?;

    // 4a. Enregistre la consommation de cet appel (tokens réellement facturés).
    let usage = payload.get("usage").cloned().unwrap_or_else(|| serde_json::json!({}));
    let prompt_tokens = usage.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let completion_tokens = usage
        .get("completion_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let cost_eur = (prompt_tokens as f64 * state.cfg.mistral_price_input_eur_per_mtok
        + completion_tokens as f64 * state.cfg.mistral_price_output_eur_per_mtok)
        / 1_000_000.0;
    sqlx::query(
        "INSERT INTO ai_usage (project_id, prompt_tokens, completion_tokens, cost_eur) VALUES ($1, $2, $3, $4)",
    )
    .bind(project_id)
    .bind(prompt_tokens)
    .bind(completion_tokens)
    .bind(cost_eur)
    .execute(&state.pool)
    .await?;

    // 4. Création des nouvelles colonnes.
    let mut all_columns = columns;
    let mut columns_created = 0usize;
    for name in plan.new_columns {
        let name = name.trim().to_string();
        if name.is_empty()
            || all_columns
                .iter()
                .any(|c| c.name.trim().eq_ignore_ascii_case(&name))
        {
            continue;
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
        all_columns.push(column);
        columns_created += 1;
    }

    // 5. Création des tickets.
    let mut next_position: HashMap<Uuid, f64> = HashMap::new();
    let maxes: Vec<(Uuid, Option<f64>)> = sqlx::query_as(
        "SELECT column_id, MAX(position) FROM tasks WHERE project_id = $1 GROUP BY column_id",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    for (column_id, max) in maxes {
        next_position.insert(column_id, max.unwrap_or(-1.0));
    }

    let mut tasks_created = 0usize;
    for ai_task in plan.tasks.into_iter().take(MAX_TASKS) {
        let title = ai_task.title.trim().to_string();
        if title.is_empty() {
            continue;
        }
        let column = all_columns
            .iter()
            .find(|c| c.name.trim().eq_ignore_ascii_case(ai_task.column.trim()))
            .or_else(|| all_columns.first())
            .ok_or_else(|| {
                AppError::BadRequest(
                    "le projet n'a aucune colonne : créez-en une avant de générer des tickets"
                        .to_string(),
                )
            })?;
        let position = {
            let entry = next_position.entry(column.id).or_insert(-1.0);
            *entry += 1.0;
            *entry
        };
        let task: Task = sqlx::query_as(
            "INSERT INTO tasks (project_id, column_id, title, description, position, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, project_id, column_id, title, description, position, assignee_id, created_by, created_at, updated_at",
        )
        .bind(project_id)
        .bind(column.id)
        .bind(&title)
        .bind(&ai_task.description)
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
        tasks_created += 1;
    }

    tracing::info!(
        project = %project_id,
        columns = columns_created,
        tasks = tasks_created,
        "Génération IA terminée"
    );
    Ok(Json(GenerationSummary {
        columns_created,
        tasks_created,
    }))
}

/// Convertit un fichier téléversé en bloc de contenu compréhensible par Mistral :
/// images en `image_url`, PDF en `document_url`, textes inlinés en clair.
fn file_to_message(
    file_name: &str,
    content_type: &str,
    data: &[u8],
) -> Result<serde_json::Value, AppError> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    if content_type.starts_with("image/") {
        Ok(serde_json::json!({
            "type": "image_url",
            "image_url": format!("data:{content_type};base64,{b64}"),
        }))
    } else if content_type == "application/pdf" {
        Ok(serde_json::json!({
            "type": "document_url",
            "document_url": format!("data:application/pdf;base64,{b64}"),
        }))
    } else {
        let text = String::from_utf8(data.to_vec())
            .map_err(|_| AppError::BadRequest(format!(
                "type de fichier non supporté : {file_name} (images, PDF et fichiers texte sont acceptés)"
            )))?;
        Ok(serde_json::json!({
            "type": "text",
            "text": format!("--- Fichier joint : {file_name} ---\n{text}"),
        }))
    }
}
