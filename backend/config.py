import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    BOT_TOKEN: str = ""
    ADMIN_IDS: str = "123456789"
    CHANNEL_ID: str = ""
    WEBAPP_URL: str = "http://localhost:5173"
    DATABASE_URL: str = "sqlite+aiosqlite:///./hatm_local.db"

    DEFAULT_TIMER_HOURS: int = 24
    POINTS_ON_COMPLETE: int = 10
    POINTS_ON_EXPIRE_PENALTY: int = 5
    CHANNEL_DEBOUNCE_SECONDS: float = 3.0

    PORT: int = 8000
    CORS_ORIGINS: str = "*"

    @property
    def admin_id_list(self) -> List[int]:
        ids: List[int] = []
        for raw in self.ADMIN_IDS.split(","):
            raw = raw.strip()
            if raw.isdigit():
                ids.append(int(raw))
        return ids

    @property
    def async_database_url(self) -> str:
        url = self.DATABASE_URL.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url


settings = Settings()
