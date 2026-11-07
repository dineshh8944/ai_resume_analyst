from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    groq_api_key: str = ""
    gemini_api_key: str = ""
    groq_model: str = "qwen/qwen3.8-27b"
    gemini_model: str = "gemini-3.5-flash"
    mongodb_uri: str = ""
    mongodb_database: str = "resume_matcher"
    # Comma-separated list of allowed browser origins.
    frontend_origin: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
