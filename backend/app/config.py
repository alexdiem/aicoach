from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str = "sqlite+aiosqlite:///./aicoach.db"
    GARMIN_CLIENT_ID: str = ""
    GARMIN_CLIENT_SECRET: str = ""
    GARMIN_REDIRECT_URI: str = "http://localhost:8000/auth/callback"
    ANTHROPIC_API_KEY: str = ""
    SECRET_KEY: str = "change-me-in-production"
    FRONTEND_URL: str = "http://localhost:5173"

    # Garmin Health API endpoints
    GARMIN_AUTH_URL: str = "https://connect.garmin.com/oauthConfirm"
    GARMIN_TOKEN_URL: str = "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0"
    GARMIN_API_BASE: str = "https://healthapi.garmin.com/wellness-api/rest"


settings = Settings()
