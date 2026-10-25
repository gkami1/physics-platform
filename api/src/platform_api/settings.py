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

    # Tutor models (OpenAI-compatible). Primary: self-hosted vLLM, e.g. http://gpu:8000/v1.
    # Fallback: DeepSeek, https://api.deepseek.com. Neither set: a scripted model (dev only).
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "Qwen/Qwen3-8B"
    llm_thinking: bool = False
    llm_fallback_base_url: str = ""
    llm_fallback_api_key: str = ""
    llm_fallback_model: str = "deepseek-chat"
    # Kopecks per million tokens, for cost tracking.
    llm_fallback_price_in: int = 0
    llm_fallback_price_out: int = 0
    # Messages per signed-in user per 24 h (free tier; plans come in M7).
    tutor_daily_messages: int = 50

    @property
    def secure_cookies(self) -> bool:
        return self.env == "prod"
