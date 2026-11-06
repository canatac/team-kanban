use std::collections::HashMap;
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::routing::post;
use axum::{Json, Router};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sqlx::types::Json as SqlJson;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::events::publish;
use crate::models::{Column, Task};
use crate::projects::require_member;
use crate::state::AppState;
use crate::tasks::{get_task_row, TASK_COLUMNS};

const MODEL: &str = "mistral-small-latest";
const MAX_FILES: usize = 5;
const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
const MAX_BODY_BYTES: usize = 30 * 1024 * 1024;
const MAX_TASKS: usize = 25;
const MAX_CHILDREN: usize = 8;

/// Champs Scrum stricts attendus du modèle pour chaque ticket.
const FICHE_RULES: &str = "Champs TOUS obligatoires et non vides :
- task_type : \"epic\" (grand ensemble à découper), \"story\" (fonctionnalité utilisateur), \"task\" (tâche technique), \"bug\" (défaut).
- user_story : « En tant que <rôle>, je veux <capacité>, afin de <bénéfice> ». Pour une tâche technique : « En tant qu'<équipe>, je veux <objectif>, afin de <bénéfice> ».
- context : problème et contexte métier, 2 à 5 phrases.
- expected_results : AU MOINS 2 résultats observables et mesurables.
- acceptance_criteria : AU MOINS 2 critères vérifiables/testables.
- definition_of_done : AU MOINS 3 critères de fin complets.
- technical_notes : pistes d'implémentation concrètes, contraintes, hypothèses, points techniques.
- story_points : entier de la suite 1, 2, 3, 5, 8, 13, 21.";

const JSON_SHAPE: &str = "{\"task_type\": \"epic|story|task|bug\", \"user_story\": \"...\", \"context\": \"...\", \"expected_results\": [\"...\"], \"acceptance_criteria\": [\"...\"], \"definition_of_done\": [\"...\"], \"technical_notes\": \"...\", \"story_points\": N}";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects/:project_id/generate", post(generate))
        .route("/api/tasks/:task_id/scrum", post(scrum))
        .route("/api/tasks/:task_id/split", post(split))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct GenerationSummary {
    columns_created: usize,
    tasks_created: usize,
}

#[derive(Serialize)]
struct ScrumResult {
    task: Task,
    split_recommendation: bool,
    split_reason: String,
}

#[derive(Serialize)]
struct SplitResult {
    created: Vec<Task>,
}

#[derive(Deserialize, Clone, Default)]
struct AiFiche {
    #[serde(default)]
    task_type: Option<String>,
    #[serde(default)]
    user_story: Option<String>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    expected_results: Vec<String>,
    #[serde(default)]
    acceptance_criteria: Vec<String>,
    #[serde(default)]
    definition_of_done: Vec<String>,
    #[serde(default)]
    technical_notes: Option<String>,
    #[serde(default)]
    story_points: Option<i32>,
}

#[derive(Deserialize)]
struct AiScrum {
    #[serde(flatten)]
    fiche: AiFiche,
    #[serde(default)]
    split_recommendation: bool,
    #[serde(default)]
    split_reason: String,
}

#[derive(Deserialize)]
struct AiChild {
    title: String,
    #[serde(flatten)]
    fiche: AiFiche,
}

#[derive(Deserialize)]
struct AiSplit {
    #[serde(default)]
    children: Vec<AiChild>,
}

#[derive(Deserialize)]
struct AiTask {
    column: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(flatten)]
    fiche: AiFiche,
}

#[derive(Deserialize)]
struct AiPlan {
    #[serde(default)]
    new_columns: Vec<String>,
    #[serde(default)]
    tasks: Vec<AiTask>,
}

#[derive(Clone, Copy)]
struct Usage {
    prompt_tokens: i64,
    completion_tokens: i64,
    cost_eur: f64,
}

// ---------------------------------------------------------------------------
// Appel Mistral + comptabilité
// ---------------------------------------------------------------------------

fn api_key(state: &AppState) -> Result<&str, AppError> {
    state
        .cfg
        .mistral_api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "la génération IA n'est pas configurée (MISTRAL_API_KEY absent)".to_string(),
            )
        })
}

async fn chat_json(
    state: &AppState,
    system: &str,
    user_content: Vec<serde_json::Value>,
) -> Result<(serde_json::Value, Usage), AppError> {
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
        .bearer_auth(api_key(state)?)
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
        return Err(AppError::Internal(format!(
            "API Mistral ({status}) : {message}"
        )));
    }

    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .ok_or_else(|| AppError::Internal("réponse Mistral inattendue".to_string()))?;
    let plan = serde_json::from_str::<serde_json::Value>(content)
        .map_err(|e| AppError::Internal(format!("réponse IA non exploitable : {e}")))?;

    let prompt_tokens = payload
        .pointer("/usage/prompt_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let completion_tokens = payload
        .pointer("/usage/completion_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let usage = Usage {
        prompt_tokens,
        completion_tokens,
        cost_eur: (prompt_tokens as f64 * state.cfg.mistral_price_input_eur_per_mtok
            + completion_tokens as f64 * state.cfg.mistral_price_output_eur_per_mtok)
            / 1_000_000.0,
    };
    Ok((plan, usage))
}

/// Journalise la consommation d'un appel. `task_id` rattache la dépense au
/// ticket concerné ; le total projet est la somme de toutes les lignes.
async fn record_usage(
    state: &AppState,
    project_id: Uuid,
    task_id: Option<Uuid>,
    usage: Usage,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO ai_usage (project_id, task_id, prompt_tokens, completion_tokens, cost_eur) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(project_id)
    .bind(task_id)
    .bind(usage.prompt_tokens)
    .bind(usage.completion_tokens)
    .bind(usage.cost_eur)
    .execute(&state.pool)
    .await?;
    Ok(())
}

fn normalize_type(raw: Option<&str>) -> String {
    match raw.map(|t| t.trim().to_ascii_lowercase()).as_deref() {
        Some("epic") => "epic".to_string(),
        Some("story") => "story".to_string(),
        Some("bug") => "bug".to_string(),
        _ => "task".to_string(),
    }
}

fn clean_list(items: &[String]) -> Vec<String> {
    items
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn fiche_is_complete(f: &AiFiche) -> bool {
    f.user_story.as_deref().is_some_and(|s| !s.trim().is_empty())
        && f.context.as_deref().is_some_and(|s| !s.trim().is_empty())
        && clean_list(&f.expected_results).len() >= 2
        && clean_list(&f.acceptance_criteria).len() >= 2
        && clean_list(&f.definition_of_done).len() >= 3
        && f.technical_notes
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty())
}

async fn insert_task(
    state: &AppState,
    project_id: Uuid,
    column_id: Uuid,
    parent_task_id: Option<Uuid>,
    title: &str,
    description: Option<&str>,
    position: f64,
    created_by: Uuid,
    fiche: &AiFiche,
) -> Result<Task, AppError> {
    let task_type = normalize_type(fiche.task_type.as_deref());
    let task: Task = sqlx::query_as(&format!(
        "INSERT INTO tasks (project_id, column_id, parent_task_id, title, description, position, created_by, task_type, user_story, context, expected_results, acceptance_criteria, definition_of_done, technical_notes, story_points) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) \
         RETURNING {TASK_COLUMNS}"
    ))
    .bind(project_id)
    .bind(column_id)
    .bind(parent_task_id)
    .bind(title)
    .bind(description)
    .bind(position)
    .bind(created_by)
    .bind(&task_type)
    .bind(&fiche.user_story)
    .bind(&fiche.context)
    .bind(SqlJson(clean_list(&fiche.expected_results)))
    .bind(SqlJson(clean_list(&fiche.acceptance_criteria)))
    .bind(SqlJson(clean_list(&fiche.definition_of_done)))
    .bind(&fiche.technical_notes)
    .bind(fiche.story_points.filter(|p| (1..=21).contains(p)))
    .fetch_one(&state.pool)
    .await?;
    Ok(task)
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:task_id/scrum — fiche Scrum IA d'un ticket
// ---------------------------------------------------------------------------

async fn scrum(
    State(state): State<AppState>,
    user: AuthUser,
    Path(task_id): Path<Uuid>,
) -> Result<Json<ScrumResult>, AppError> {
    let task = get_task_row(&state, task_id).await?;
    let project_id = task.project_id;
    require_member(&state.pool, user.user_id, project_id).await?;

    let (project_name,): (String,) = sqlx::query_as("SELECT name FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_one(&state.pool)
        .await?;
    let parent: Option<(String, Option<String>)> = match task.parent_task_id {
        Some(pid) => {
            sqlx::query_as("SELECT title, user_story FROM tasks WHERE id = $1")
                .bind(pid)
                .fetch_optional(&state.pool)
                .await?
        }
        None => None,
    };

    let system = format!(
        "Tu es un Product Owner Scrum senior. Rédige la fiche Scrum complète du ticket décrit \
ci-dessous, pour qu'un développeur (humain ou assistant de développement IA) puisse travailler \
sans aucune ambiguïté.\n\
Réponds STRICTEMENT en JSON, sans texte autour : {JSON_SHAPE}, \"split_recommendation\": true|false, \"split_reason\": \"...\"\n\
{FICHE_RULES}\n\
split_recommendation : true uniquement si le ticket est trop large pour un seul incrément \
(plusieurs livrables distincts, plus d'un sprint) ; split_reason justifie alors le découpage \
proposé (sinon chaîne vide)."
    );

    let mut brief = format!(
        "Projet : {project_name}\nTicket : {}\nDescription : {}\nType actuel : {}",
        task.title,
        task.description.as_deref().unwrap_or("(aucune)"),
        task.task_type,
    );
    if let Some((parent_title, parent_story)) = &parent {
        brief.push_str(&format!(
            "\nTicket parent : {parent_title}\nUser story du parent : {}",
            parent_story.as_deref().unwrap_or("(aucune)"
            )
        ));
    }

    let (plan, usage) = chat_json(
        &state,
        &system,
        vec![serde_json::json!({ "type": "text", "text": brief })],
    )
    .await?;
    let parsed: AiScrum = serde_json::from_value(plan)
        .map_err(|e| AppError::Internal(format!("réponse IA non exploitable : {e}")))?;
    if !fiche_is_complete(&parsed.fiche) {
        return Err(AppError::BadRequest(
            "la fiche générée était incomplète — réessayez, ou précisez d'abord la description du ticket".to_string(),
        ));
    }

    let fiche = &parsed.fiche;
    let task_type = normalize_type(fiche.task_type.as_deref());
    let updated: Task = sqlx::query_as(&format!(
        "UPDATE tasks SET task_type = $2, user_story = $3, context = $4, expected_results = $5, acceptance_criteria = $6, definition_of_done = $7, technical_notes = $8, story_points = $9, updated_at = now() WHERE id = $1 RETURNING {TASK_COLUMNS}"
    ))
    .bind(task_id)
    .bind(&task_type)
    .bind(fiche.user_story.as_deref().map(str::trim))
    .bind(fiche.context.as_deref().map(str::trim))
    .bind(SqlJson(clean_list(&fiche.expected_results)))
    .bind(SqlJson(clean_list(&fiche.acceptance_criteria)))
    .bind(SqlJson(clean_list(&fiche.definition_of_done)))
    .bind(fiche.technical_notes.as_deref().map(str::trim))
    .bind(fiche.story_points.filter(|p| (1..=21).contains(p)))
    .fetch_one(&state.pool)
    .await?;

    record_usage(&state, project_id, Some(task_id), usage).await?;
    publish(
        &state,
        &project_id,
        "task.updated",
        serde_json::to_value(&updated).unwrap_or(serde_json::Value::Null),
    );
    tracing::info!(
        project = %project_id,
        task = %task_id,
        "Fiche Scrum générée"
    );
    Ok(Json(ScrumResult {
        task: updated,
        split_recommendation: parsed.split_recommendation,
        split_reason: parsed.split_reason.trim().to_string(),
    }))
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:task_id/split — découpage IA d'un ticket
// ---------------------------------------------------------------------------

async fn split(
    State(state): State<AppState>,
    user: AuthUser,
    Path(task_id): Path<Uuid>,
) -> Result<Json<SplitResult>, AppError> {
    let task = get_task_row(&state, task_id).await?;
    let project_id = task.project_id;
    require_member(&state.pool, user.user_id, project_id).await?;

    let (project_name,): (String,) = sqlx::query_as("SELECT name FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_one(&state.pool)
        .await?;

    let child_kind = match task.task_type.as_str() {
        "epic" => "user stories",
        _ => "tâches techniques",
    };
    let child_type = if task.task_type == "epic" { "story" } else { "task" };

    let system = format!(
        "Tu es un Product Owner Scrum senior. Découpe le ticket décrit ci-dessous en {child_kind} \
(2 à {MAX_CHILDREN} enfants). L'ensemble des enfants doit couvrir TOUT le périmètre du parent, \
sans doublon ni trou, et chaque enfant doit pouvoir être livré indépendamment.\n\
Réponds STRICTEMENT en JSON, sans texte autour : {{\"children\": [{{\"title\": \"titre court\", \
{JSON_SHAPE}}}, ...]}}\n\
{FICHE_RULES}\n\
Pour chaque enfant, task_type doit être \"{child_type}\". Les titres sont courts (moins de 80 caractères)."
    );

    let brief = format!(
        "Projet : {project_name}\nTicket à découper : {}\nDescription : {}\nType actuel : {}\nUser story : {}\nContexte : {}",
        task.title,
        task.description.as_deref().unwrap_or("(aucune)"),
        task.task_type,
        task.user_story.as_deref().unwrap_or("(aucune)"),
        task.context.as_deref().unwrap_or("(aucun)"),
    );

    let (plan, usage) = chat_json(
        &state,
        &system,
        vec![serde_json::json!({ "type": "text", "text": brief })],
    )
    .await?;
    let parsed: AiSplit = serde_json::from_value(plan)
        .map_err(|e| AppError::Internal(format!("réponse IA non exploitable : {e}")))?;

    let children: Vec<AiChild> = parsed
        .children
        .into_iter()
        .filter(|c| !c.title.trim().is_empty() && fiche_is_complete(&c.fiche))
        .take(MAX_CHILDREN)
        .collect();
    if children.len() < 2 {
        return Err(AppError::BadRequest(
            "le découpage proposé était incomplet — réessayez, ou générez d'abord la fiche Scrum du ticket".to_string(),
        ));
    }

    // Positionne les enfants après les tâches existantes de la colonne du parent.
    let row: (Option<f64>,) = sqlx::query_as(
        "SELECT MAX(position) FROM tasks WHERE column_id = $1",
    )
    .bind(task.column_id)
    .fetch_one(&state.pool)
    .await?;
    let mut position = row.0.unwrap_or(-1.0);

    let mut created: Vec<Task> = Vec::with_capacity(children.len());
    for child in &children {
        position += 1.0;
        let task_row = insert_task(
            &state,
            project_id,
            task.column_id,
            Some(task_id),
            child.title.trim(),
            None,
            position,
            user.user_id,
            &child.fiche,
        )
        .await?;
        publish(
            &state,
            &project_id,
            "task.created",
            serde_json::to_value(&task_row).unwrap_or(serde_json::Value::Null),
        );
        created.push(task_row);
    }

    // Répartit la consommation de l'appel sur les tickets créés (le total
    // projet est la somme exacte des tickets).
    let share = Usage {
        prompt_tokens: usage.prompt_tokens / created.len() as i64,
        completion_tokens: usage.completion_tokens / created.len() as i64,
        cost_eur: usage.cost_eur / created.len() as f64,
    };
    for task_row in &created {
        record_usage(&state, project_id, Some(task_row.id), share).await?;
    }

    tracing::info!(
        project = %project_id,
        parent = %task_id,
        children = created.len(),
        "Ticket découpé par IA"
    );
    Ok(Json(SplitResult { created }))
}

// ---------------------------------------------------------------------------
// POST /api/projects/:project_id/generate — génération en masse
// ---------------------------------------------------------------------------

async fn generate(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<GenerationSummary>, AppError> {
    require_member(&state.pool, user.user_id, project_id).await?;

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
        "Tu es l'assistant Product Owner d'un tableau Kanban. À partir du brief de l'utilisateur \
(et des éventuels fichiers joints), tu génères des tickets de travail prêts à être développés, \
chacun avec sa fiche Scrum complète.\n\
Colonnes existantes du tableau : [{}].\n\
Réponds STRICTEMENT en JSON, sans texte autour : \
{{\"new_columns\": [\"Nom de colonne\", ...], \"tasks\": [{{\"column\": \"Nom de colonne\", \"title\": \"titre court\", \"description\": \"résumé en 1-2 phrases\", {JSON_SHAPE}}}, ...]}}\n\
{FICHE_RULES}\n\
- Place les tickets dans les colonnes existantes quand c'est pertinent (reprends leur nom exact dans \"column\").\n\
- Si le brief le justifie, propose de nouvelles colonnes dans \"new_columns\" (elles seront créées avant les tickets) ; place alors certains tickets dans ces nouvelles colonnes. Sinon laisse \"new_columns\" vide.\n\
- Génère entre 3 et 15 tickets, couvrant concrètement le brief ; saute les tickets trop vagues.\n\
- Identifie comme \"epic\" les ensembles trop larges pour un seul incrément ; ils pourront être \
découpés ensuite en user stories. Les tickets plus fins sont des \"story\" ou \"task\".\n\
- \"column\" doit toujours exister dans les colonnes existantes ou dans \"new_columns\"."
        , column_names.join(", ")
    );

    let mut user_content: Vec<serde_json::Value> =
        vec![serde_json::json!({ "type": "text", "text": prompt })];
    user_content.extend(file_parts);

    let (plan, usage) = chat_json(&state, &system, user_content).await?;
    let parsed: AiPlan = serde_json::from_value(plan)
        .map_err(|e| AppError::Internal(format!("réponse IA non exploitable : {e}")))?;

    // 4. Création des nouvelles colonnes.
    let mut all_columns = columns;
    let mut columns_created = 0usize;
    for name in parsed.new_columns {
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

    // 5. Création des tickets avec leur fiche Scrum.
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

    let mut created_tasks: Vec<Task> = Vec::new();
    for ai_task in parsed.tasks.into_iter().take(MAX_TASKS) {
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
        let task_row = insert_task(
            &state,
            project_id,
            column.id,
            None,
            &title,
            ai_task.description.as_deref().map(str::trim),
            position,
            user.user_id,
            &ai_task.fiche,
        )
        .await?;
        publish(
            &state,
            &project_id,
            "task.created",
            serde_json::to_value(&task_row).unwrap_or(serde_json::Value::Null),
        );
        created_tasks.push(task_row);
    }

    // 6. Répartit la consommation de l'appel sur les tickets créés ;
    //    à défaut, la rattache au projet.
    let tasks_created = created_tasks.len();
    if tasks_created == 0 {
        record_usage(&state, project_id, None, usage).await?;
    } else {
        let share = Usage {
            prompt_tokens: usage.prompt_tokens / tasks_created as i64,
            completion_tokens: usage.completion_tokens / tasks_created as i64,
            cost_eur: usage.cost_eur / tasks_created as f64,
        };
        for task_row in &created_tasks {
            record_usage(&state, project_id, Some(task_row.id), share).await?;
        }
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
        let text = String::from_utf8(data.to_vec()).map_err(|_| {
            AppError::BadRequest(format!(
                "type de fichier non supporté : {file_name} (images, PDF et fichiers texte sont acceptés)"
            ))
        })?;
        Ok(serde_json::json!({
            "type": "text",
            "text": format!("--- Fichier joint : {file_name} ---\n{text}"),
        }))
    }
}
