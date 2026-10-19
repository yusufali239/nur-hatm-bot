import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    BOT_TOKEN: str = ""
    # Optional: bot username without "@". Auto-detected from Telegram on startup if empty.
    BOT_USERNAME: str = ""
    ADMIN_IDS: str = "123456789"
    CHANNEL_ID: str = ""
    WEBAPP_URL: str = "https://nur-hatm-bot.vercel.app"
    DATABASE_URL: str = "sqlite+aiosqlite:///./hatm_local.db"

    # Default booking period for NEW hatms (admin changes it per hatm in the admin panel)
    DEFAULT_TIMER_HOURS: int = 72
    POINTS_ON_COMPLETE: int = 10
    POINTS_ON_EXPIRE_PENALTY: int = 5
    CHANNEL_DEBOUNCE_SECONDS: float = 3.0

    PORT: int = 8000
    CORS_ORIGINS: str = "*"

    # How long a signed Telegram initData stays valid (a Mini App session can stay open for days)
    INIT_DATA_MAX_AGE_SECONDS: int = 3 * 24 * 3600

    @property
    def dev_mode(self) -> bool:
        """True when no real BOT_TOKEN is configured: Telegram signature checks are skipped."""
        token = self.BOT_TOKEN.strip()
        return not token or token.endswith("your_telegram_bot_token_here")

    @property
    def admin_id_list(self) -> List[int]:
        ids: List[int] = []
        for raw in self.ADMIN_IDS.split(","):
            raw = raw.strip()
            if raw.isdigit():
                ids.append(int(raw))
        return ids

    def bot_link(self, hatm_id: Optional[int] = None) -> str:
        """Deep link to the bot itself (t.me/<bot>?start=hatm_<id>). Falls back to WEBAPP_URL."""
        uname = self.BOT_USERNAME.strip().lstrip("@")
        if not uname:
            return self.WEBAPP_URL
        link = f"https://t.me/{uname}"
        if hatm_id:
            link += f"?start=hatm_{hatm_id}"
        return link

    @property
    def async_database_url(self) -> str:
        url = self.DATABASE_URL.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if "sslmode=require" in url:
            url = url.replace("sslmode=require", "ssl=require")
        return url


settings = Settings()
