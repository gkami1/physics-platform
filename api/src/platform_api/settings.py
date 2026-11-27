from pathlib import Path
from typing import Any, Literal

from pydantic import Field
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
    # Development: Google AI Studio's free tier as primary (see .env.example). Never in prod:
    # the free tier may use prompts for training and is outside Russia.
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "Qwen/Qwen3-8B"
    # Extra request fields for the primary, as JSON in API_LLM_EXTRA_BODY. Default: Qwen3 on
    # vLLM answers directly (hidden reasoning only adds latency). Other providers may reject
    # unknown fields: Gemini wants {} or {"reasoning_effort": "none"}.
    llm_extra_body: dict[str, Any] = {"chat_template_kwargs": {"enable_thinking": False}}
    # Proxy for the primary's calls only, e.g. http://127.0.0.1:10809 from a local VPN client
    # (Google refuses requests from Russia). Dev only.
    llm_proxy: str = ""
    llm_fallback_base_url: str = ""
    llm_fallback_api_key: str = ""
    llm_fallback_model: str = "deepseek-chat"
    # Kopecks per million tokens, for cost tracking.
    llm_fallback_price_in: int = 0
    llm_fallback_price_out: int = 0
    # Tutor messages per signed-in user per 24 h: free, and with an active pass.
    tutor_daily_messages: int = 20
    tutor_paid_daily_messages: int = 100
    # Fair use for passes: model spend over the last 30 days above this (kopecks) drops the
    # user back to the free daily cap until it falls under again. 0 disables the check.
    tutor_paid_monthly_budget_kop: int = 40000

    # Payments: Robokassa (it issues «Мой налог» receipts for самозанятые). An empty login
    # turns checkout off (503). Test mode sends IsTest=1: use the shop's test passwords then.
    robokassa_login: str = ""
    robokassa_password1: str = ""
    robokassa_password2: str = ""
    robokassa_test: bool = True
    # Must match «Алгоритм расчёта хеша» in the shop's technical settings.
    robokassa_hash: Literal["md5", "sha256", "sha384", "sha512"] = "md5"
    # Positive prices in kopecks, bounded by the payments.amount_kop INTEGER column.
    price_month_kop: int = Field(default=79000, gt=0, le=2**31 - 1)
    price_season_kop: int = Field(default=299000, gt=0, le=2**31 - 1)
    price_month_override_email: str = ""
    price_month_override_kop: int = Field(default=5000, gt=0, le=2**31 - 1)

    @property
    def payments_enabled(self) -> bool:
        return bool(self.robokassa_login and self.robokassa_password1 and self.robokassa_password2)

    @property
    def secure_cookies(self) -> bool:
        return self.env == "prod"
