from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"
    # Directory with content-build's private bundles (<exam-id>.json).
    private_content_dir: Path = Path("build/private")
    database_url: str = "postgresql+asyncpg://physics:physics@localhost:5432/physics"

    @property
    def secure_cookies(self) -> bool:
        return self.env == "prod"
