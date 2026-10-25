"""Outgoing email. Only login codes for now."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import Protocol

from platform_api.settings import Settings

logger = logging.getLogger("api.mail")


class Mailer(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class LogMailer:
    """Dev fallback: writes the email to the log instead of sending it."""

    async def send(self, to: str, subject: str, body: str) -> None:
        logger.warning(
            "email not sent (no SMTP configured)", extra={"subject": subject, "body": body}
        )


class MemoryMailer:
    """Collects emails in memory (tests)."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def _send_sync(self, msg: EmailMessage) -> None:
        s = self._s
        smtp: smtplib.SMTP
        if s.smtp_port == 465:
            smtp = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15)
        else:
            smtp = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
            smtp.starttls()
        with smtp:
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)

    async def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = self._s.mail_from or self._s.smtp_user
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        await asyncio.to_thread(self._send_sync, msg)


def make_mailer(settings: Settings) -> Mailer:
    if settings.smtp_host:
        return SmtpMailer(settings)
    if settings.env == "prod":
        logger.warning("API_SMTP_HOST is not set: login codes will be written to the log")
    return LogMailer()


def login_code_email(code: str, valid_minutes: int) -> tuple[str, str]:
    subject = f"Код для входа: {code}"
    body = (
        f"Ваш код для входа на «Физика ЕГЭ»: {code}\n\n"
        f"Код действует {valid_minutes} мин. "
        "Если вы не запрашивали вход, просто проигнорируйте это письмо.\n"
    )
    return subject, body
