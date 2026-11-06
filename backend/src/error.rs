use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

#[derive(Debug)]
pub enum AppError {
    Unauthorized,
    Forbidden,
    NotFound,
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Non authentifié".to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "Accès refusé".to_string()),
            AppError::NotFound => (StatusCode::NOT_FOUND, "Ressource introuvable".to_string()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Internal(m) => {
                tracing::error!("Erreur interne : {m}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Erreur interne".to_string())
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound,
            _ => AppError::Internal(e.to_string()),
        }
    }
}
