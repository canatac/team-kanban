mod ai;
mod auth;
mod columns;
mod comments;
mod config;
mod error;
mod events;
mod models;
mod projects;
mod state;
mod tasks;
mod ws;

use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cfg = Config::from_env();

    // Attend que PostgreSQL soit prêt (démarrage Docker).
    let pool = loop {
        match PgPoolOptions::new()
            .max_connections(10)
            .connect(&cfg.database_url)
            .await
        {
            Ok(pool) => break pool,
            Err(e) => {
                tracing::warn!("Postgres indisponible ({e}), nouvelle tentative...");
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    };

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("Migrations appliquées");

    let (events, _) = broadcast::channel(64);
    let state = AppState { pool, cfg, events };

    let app = axum::Router::new()
        .merge(auth::router())
        .merge(ai::router())
        .merge(projects::router())
        .merge(columns::router())
        .merge(tasks::router())
        .merge(comments::router())
        .route("/ws", axum::routing::get(ws::ws_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("Backend en écoute sur 0.0.0.0:8080");
    axum::serve(listener, app).await?;
    Ok(())
}
