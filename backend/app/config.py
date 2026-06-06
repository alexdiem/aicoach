from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str = "sqlite+aiosqlite:///./aicoach.db"
    GARMIN_EMAIL: str = ""
    GARMIN_PASSWORD: str = ""
    ANTHROPIC_API_KEY: str = ""
    SECRET_KEY: str = "change-me-in-production"
    FRONTEND_URL: str = "http://localhost:5173"


settings = Settings()
