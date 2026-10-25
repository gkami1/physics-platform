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

    # Outgoing mail for login codes. Empty host = write emails to the log instead (dev).
    # Use a Russian provider (152-FZ), e.g. Yandex 360: smtp.yandex.ru, port 465.
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = ""

    @property
    def secure_cookies(self) -> bool:
        return self.env == "prod"
