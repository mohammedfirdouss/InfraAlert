"""
Sending one email. OWNER: agent "notify-backend" (implementations). The protocol is fixed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


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
