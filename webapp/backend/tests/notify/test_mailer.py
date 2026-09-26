from __future__ import annotations

import email
import email.policy
import smtplib
import uuid
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pytest

from infraalert.config import Settings
from infraalert.deps import build_deps
from infraalert.notify import mailer as mailer_module
from infraalert.notify.mailer import ConsoleMailer, Email, SmtpMailer
from infraalert.notify.tokens import (
    mask_email,
    normalise_email,
    read_unsubscribe_token,
    unsubscribe_token,
)

SENDER = "InfraAlert <no-reply@city.test>"
MESSAGE = Email(to="alice@example.com", subject="Hello", text="Plain body", html="<p>HTML body</p>")


class FakeSmtp:
    """Stands in for smtplib.SMTP and records what happened."""

    instances: list[FakeSmtp] = []

    def __init__(self, host: str, port: int, timeout: float) -> None:
        self.connected = (host, port, timeout)
        self.calls: list[str] = []
        self.login_args: tuple[str, str] | None = None
        self.messages: list[EmailMessage] = []
        FakeSmtp.instances.append(self)

    def __enter__(self) -> FakeSmtp:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.calls.append("quit")

    def starttls(self) -> None:
        self.calls.append("starttls")

    def login(self, username: str, password: str) -> None:
        self.calls.append("login")
        self.login_args = (username, password)

    def send_message(self, message: EmailMessage) -> None:
        self.calls.append("send")
        self.messages.append(message)


@pytest.fixture(autouse=True)
def _reset() -> None:
    FakeSmtp.instances.clear()


def _smtp(**kwargs: Any) -> SmtpMailer:
    return SmtpMailer(
        "smtp.test",
        587,
        SENDER,
        smtp_class=FakeSmtp,  # type: ignore[arg-type]
        **kwargs,
    )


def test_smtp_sends_a_text_and_html_message_over_starttls_with_login() -> None:
    _smtp(username="user", password="pw").send(MESSAGE)

    [smtp] = FakeSmtp.instances
    assert smtp.connected == ("smtp.test", 587, 10.0)
    assert smtp.calls == ["starttls", "login", "send", "quit"]
    assert smtp.login_args == ("user", "pw")
    [message] = smtp.messages
    assert message["From"] == SENDER
    assert message["To"] == "alice@example.com"
    assert message["Subject"] == "Hello"
    assert message["Message-ID"].endswith("@city.test>")
    assert message.get_content_type() == "multipart/alternative"
    text = message.get_body(("plain",))
    html = message.get_body(("html",))
    assert text is not None and html is not None
    assert text.get_content().strip() == "Plain body"
    assert html.get_content().strip() == "<p>HTML body</p>"


def test_smtp_skips_login_without_a_username() -> None:
    _smtp().send(Email(to="a@example.com", subject="S", text="T"))
    [smtp] = FakeSmtp.instances
    assert smtp.calls == ["starttls", "send", "quit"]
    assert smtp.messages[0].get_content_type() == "text/plain"


def test_smtp_errors_propagate_so_the_outbox_retries() -> None:
    class Refusing(FakeSmtp):
        def send_message(self, message: EmailMessage) -> None:
            raise smtplib.SMTPRecipientsRefused({})

    mailer = SmtpMailer("smtp.test", 587, SENDER, smtp_class=Refusing)  # type: ignore[arg-type]
    with pytest.raises(smtplib.SMTPException):
        mailer.send(MESSAGE)


def test_console_mailer_writes_an_eml_file(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    outbox = tmp_path / "outbox"
    # Alembic's fileConfig (run by the test database setup) disables existing loggers.
    monkeypatch.setattr(mailer_module.logger, "disabled", False)
    caplog.set_level("INFO", logger=mailer_module.logger.name)

    path = ConsoleMailer(outbox, SENDER).send(MESSAGE)

    assert path.parent == outbox and path.suffix == ".eml"
    parsed = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
    assert parsed["To"] == "alice@example.com"
    assert parsed["Subject"] == "Hello"
    assert isinstance(parsed, EmailMessage)
    body = parsed.get_body(("html",))
    assert body is not None and "HTML body" in body.get_content()
    assert "Hello" in caplog.text and str(path) in caplog.text


def test_build_deps_wires_the_configured_mailer(tmp_path: Path) -> None:
    base = dict(
        database_url="postgresql+psycopg://u:p@localhost:1/x",
        turnstile_secret_key="k",
        rate_limit_secret="s",
        local_outbox_dir=tmp_path,
    )
    assert isinstance(build_deps(Settings(**base)).mailer, ConsoleMailer)  # type: ignore[arg-type]
    smtp = Settings(**base, email_backend="smtp", smtp_host="smtp.test")  # type: ignore[arg-type]
    assert isinstance(build_deps(smtp).mailer, SmtpMailer)


# Tokens and addresses


@pytest.mark.parametrize(
    ("raw", "normal"),
    [
        (" Alice@Gmail.COM ", "alice@gmail.com"),
        ("a.b+tag@sub.example.org", "a.b+tag@sub.example.org"),
        ("no-at-sign", None),
        ("two@@example.com", None),
        ("spaces in@example.com", None),
        ("a@localhost", None),
        ("a@example.", None),
        ("x" * 250 + "@example.com", None),
    ],
)
def test_normalise_email(raw: str, normal: str | None) -> None:
    assert normalise_email(raw) == normal


def test_mask_email() -> None:
    assert mask_email("alice@gmail.com") == "a•••@gmail.com"
    assert mask_email("a@gmail.com") == "a•••@gmail.com"


def test_unsubscribe_tokens_identify_the_subscription_and_cant_be_forged() -> None:
    report, contact = uuid.uuid4(), uuid.uuid4()
    token = unsubscribe_token("secret", report, contact)

    assert read_unsubscribe_token("secret", token) == (report, contact)
    assert read_unsubscribe_token("other-secret", token) is None
    swapped = f"{uuid.uuid4().hex}.{contact.hex}.{token.rsplit('.', 1)[1]}"
    assert read_unsubscribe_token("secret", swapped) is None
    assert read_unsubscribe_token("secret", token[:-2]) is None
    assert read_unsubscribe_token("secret", "a.b.c") is None
