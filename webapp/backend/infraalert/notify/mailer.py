"""
Sending one email. The `Email` / `Mailer` protocol is fixed; `SmtpMailer` sends through
any SMTP provider, `ConsoleMailer` (development) writes .eml files instead.
"""

from __future__ import annotations

import logging
import smtplib
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str | None = None


class Mailer(Protocol):
    def send(self, email: Email) -> None:
        """Deliver or raise. The outbox retries on any exception."""
        ...


def build_message(email: Email, sender: str) -> EmailMessage:
    """A text message, with an HTML alternative when there is one."""
    message = EmailMessage()
    message["From"] = sender
    message["To"] = email.to
    message["Subject"] = email.subject
    message["Date"] = formatdate(localtime=False)
    _, address = parseaddr(sender)
    message["Message-ID"] = make_msgid(domain=address.rpartition("@")[2] or None)
    message.set_content(email.text)
    if email.html is not None:
        message.add_alternative(email.html, subtype="html")
    return message


class SmtpMailer:
    """SMTP with STARTTLS (port 587), logging in when a username is set."""

    def __init__(
        self,
        host: str,
        port: int,
        sender: str,
        username: str | None = None,
        password: str | None = None,
        timeout: float = 10.0,
        smtp_class: type[smtplib.SMTP] = smtplib.SMTP,
    ) -> None:
        self._host = host
        self._port = port
        self._sender = sender
        self._username = username
        self._password = password
        self._timeout = timeout
        self._smtp_class = smtp_class

    def send(self, email: Email) -> None:
        message = build_message(email, self._sender)
        with self._smtp_class(self._host, self._port, timeout=self._timeout) as smtp:
            smtp.starttls()
            if self._username:
                smtp.login(self._username, self._password or "")
            smtp.send_message(message)


class ConsoleMailer:
    """Development: each email becomes a .eml file in `outbox_dir` (open it in any mail app)."""

    def __init__(self, outbox_dir: Path, sender: str) -> None:
        self._outbox_dir = outbox_dir
        self._sender = sender

    def send(self, email: Email) -> Path:
        self._outbox_dir.mkdir(parents=True, exist_ok=True)
        path = self._outbox_dir / f"{uuid.uuid4().hex}.eml"
        path.write_bytes(bytes(build_message(email, self._sender)))
        logger.info("Email to the local outbox: %r -> %s", email.subject, path)
        return path
