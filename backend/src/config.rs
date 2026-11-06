#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub app_url: String,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub jwt_secret: String,
    /// Clé API Mistral pour la génération de tickets (fonctionnalité optionnelle).
    pub mistral_api_key: Option<String>,
    /// Tarifs Mistral Small (euros par million de tokens), ajustables via l'environnement.
    pub mistral_price_input_eur_per_mtok: f64,
    pub mistral_price_output_eur_per_mtok: f64,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL requis"),
            app_url: std::env::var("APP_URL").expect("APP_URL requis"),
            github_client_id: std::env::var("GITHUB_CLIENT_ID").expect("GITHUB_CLIENT_ID requis"),
            github_client_secret: std::env::var("GITHUB_CLIENT_SECRET")
                .expect("GITHUB_CLIENT_SECRET requis"),
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET requis"),
            mistral_api_key: std::env::var("MISTRAL_API_KEY").ok(),
            mistral_price_input_eur_per_mtok: env_f64("MISTRAL_PRICE_INPUT_EUR_PER_MTOK", 0.15),
            mistral_price_output_eur_per_mtok: env_f64("MISTRAL_PRICE_OUTPUT_EUR_PER_MTOK", 0.60),
        }
    }
}

fn env_f64(name: &str, default: f64) -> f64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(default)
}
