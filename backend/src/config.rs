#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub app_url: String,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub jwt_secret: String,
    /// Clé API Mistral pour la génération de tickets (fonctionnalité optionnelle).
    pub mistral_api_key: Option<String>,
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
        }
    }
}
