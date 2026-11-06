use sqlx::PgPool;
use tokio::sync::broadcast;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub cfg: Config,
    pub events: broadcast::Sender<serde_json::Value>,
}
