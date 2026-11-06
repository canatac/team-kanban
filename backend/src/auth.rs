use std::collections::HashMap;

use axum::async_trait;
use axum::extract::{FromRequestParts, Query, State};
use axum::http::{header, request::Parts, HeaderMap};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::models::User;
use crate::state::AppState;

pub struct AuthUser {
    pub user_id: Uuid,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

fn get_cookie(parts: &Parts, name: &str) -> Option<String> {
    let header_value = parts.headers.get(header::COOKIE)?.to_str().ok()?;
    for pair in header_value.split(';') {
        let pair = pair.trim();
        if let Some(rest) = pair.strip_prefix(name) {
            if let Some(value) = rest.strip_prefix('=') {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn make_jwt(user_id: Uuid, secret: &str) -> Result<String, AppError> {
    let exp = (Utc::now() + Duration::days(7)).timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| AppError::Internal("échec de génération du jeton".to_string()))
}

fn session_cookie(value: &str, max_age: i64) -> String {
    format!("session={value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={max_age}")
}

fn state_cookie(value: &str, max_age: i64) -> String {
    format!("oauth_state={value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={max_age}")
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = get_cookie(parts, "session").ok_or(AppError::Unauthorized)?;
        let data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(state.cfg.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| AppError::Unauthorized)?;
        let user_id = Uuid::parse_str(&data.claims.sub).map_err(|_| AppError::Unauthorized)?;
        Ok(AuthUser { user_id })
    }
}

#[derive(Deserialize)]
struct GithubTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GithubUser {
    id: i64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

async fn github_login(State(state): State<AppState>) -> Response {
    let oauth_state = Uuid::new_v4().simple().to_string();
    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}/api/auth/github/callback&scope=read%3Auser&state={oauth_state}",
        state.cfg.github_client_id, state.cfg.app_url
    );
    let mut res = Redirect::to(&url).into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, state_cookie(&oauth_state, 600).parse().unwrap());
    res
}

async fn github_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, AppError> {
    let Some(code) = params.get("code") else {
        return Err(AppError::BadRequest("paramètre code manquant".to_string()));
    };
    let Some(oauth_state) = params.get("state") else {
        return Err(AppError::BadRequest("paramètre state manquant".to_string()));
    };
    let cookie_header = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = cookie_header
        .split(';')
        .find_map(|c| c.trim().strip_prefix("oauth_state="))
        .unwrap_or("");
    if expected.is_empty() || expected != oauth_state {
        return Err(AppError::BadRequest("state OAuth invalide".to_string()));
    }

    let redirect_uri = format!("{}/api/auth/github/callback", state.cfg.app_url);
    let client = reqwest::Client::new();
    let token: GithubTokenResponse = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": state.cfg.github_client_id,
            "client_secret": state.cfg.github_client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let gh_user: GithubUser = client
        .get("https://api.github.com/user")
        .header("User-Agent", "team-kanban")
        .header("Authorization", format!("Bearer {}", token.access_token))
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let user: User = sqlx::query_as("INSERT INTO users (github_id, login, name, avatar_url) VALUES ($1, $2, $3, $4) ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url RETURNING id, github_id, login, name, avatar_url, created_at")
        .bind(gh_user.id)
        .bind(&gh_user.login)
        .bind(&gh_user.name)
        .bind(&gh_user.avatar_url)
        .fetch_one(&state.pool)
        .await?;

    let jwt = make_jwt(user.id, &state.cfg.jwt_secret)?;
    let mut res = Redirect::to("/").into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, session_cookie(&jwt, 604_800).parse().unwrap());
    res.headers_mut()
        .append(header::SET_COOKIE, state_cookie("", 0).parse().unwrap());
    Ok(res)
}

async fn me(State(state): State<AppState>, user: AuthUser) -> Result<Json<User>, AppError> {
    let current: User = sqlx::query_as(
        "SELECT id, github_id, login, name, avatar_url, created_at FROM users WHERE id = $1",
    )
    .bind(user.user_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(current))
}

async fn logout() -> Response {
    let mut res = Redirect::to("/").into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, session_cookie("", 0).parse().unwrap());
    res
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/github", get(github_login))
        .route("/api/auth/github/callback", get(github_callback))
        .route("/api/auth/logout", post(logout))
        .route("/api/me", get(me))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jwt_aller_retour() {
        let user_id = Uuid::new_v4();
        let token = make_jwt(user_id, "secret-de-test").unwrap();
        let data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret("secret-de-test".as_bytes()),
            &Validation::default(),
        )
        .unwrap();
        assert_eq!(data.claims.sub, user_id.to_string());
    }
}
