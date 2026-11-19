from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Application settings, loaded from environment variables / the root .env file."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_name: str = "WAYRA – SafeRoute"
    database_url: str = "sqlite:///./wayra.db"
    # Set a long random value in .env (see .env.example). The default is for local dev/tests only.
    jwt_secret: str = "change-me-dev-only-insecure-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24
    cors_origins: list[str] = ["http://localhost:5173"]
    # Nominatim requires an identifying User-Agent; add contact info via .env if you deploy.
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    nominatim_user_agent: str = "WAYRA-SafeRoute/0.1 (women-safety routing prototype)"
    # Routing/heatmap data written by the ml/ pipeline (npm run train / npm run score).
    data_dir: Path = REPO_ROOT / "data"
    metrics_path: Path = REPO_ROOT / "ml" / "reports" / "metrics.json"
    load_routing_data: bool = True
    # Public URL of the web app, used in links sent to contacts (watch / track pages).
    public_base_url: str = "http://localhost:5173"
    # Optional notifiers: switched on only when these are set (see services/notifier.py).
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = ""


settings = Settings()
