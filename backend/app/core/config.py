from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, loaded from environment variables / the root .env file."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_name: str = "WAYRA – SafeRoute"
    database_url: str = "sqlite:///./wayra.db"
    jwt_secret: str = "change-me"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
