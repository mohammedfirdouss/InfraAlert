"""
The secrets in citizen update links, and how addresses are shown back.

Verification tokens are random, single-use and stored only as a SHA-256 hash, so a
database leak can't be turned into working links.

Unsubscribe tokens are stateless: `<report hex>.<contact hex>.<HMAC>` with the HMAC
keyed by the server secret (RATE_LIMIT_SECRET, domain-separated with a prefix). They
identify one (report, contact) subscription, can't be forged or guessed without the
secret, need no table, and keep working in old emails for as long as the secret lasts.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid

_UNSUBSCRIBE_DOMAIN = b"infraalert.unsubscribe.v1:"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s.]+$")
MAX_EMAIL_LENGTH = 254


def normalise_email(raw: str) -> str | None:
    """Trimmed and lowercased, or None when it doesn't look like an address."""
    email = raw.strip().lower()
    if len(email) > MAX_EMAIL_LENGTH or not _EMAIL.match(email):
        return None
    return email


def mask_email(email: str) -> str:
    """'alice@gmail.com' -> 'a•••@gmail.com'."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}•••@{domain}"


def new_verification_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _unsubscribe_mac(secret: str, report_id: uuid.UUID, contact_id: uuid.UUID) -> str:
    message = _UNSUBSCRIBE_DOMAIN + report_id.bytes + contact_id.bytes
    digest = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def unsubscribe_token(secret: str, report_id: uuid.UUID, contact_id: uuid.UUID) -> str:
    mac = _unsubscribe_mac(secret, report_id, contact_id)
    return f"{report_id.hex}.{contact_id.hex}.{mac}"


def read_unsubscribe_token(secret: str, token: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    """The (report, contact) the token was made for, or None if it isn't genuine."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        report_id, contact_id = uuid.UUID(hex=parts[0]), uuid.UUID(hex=parts[1])
    except ValueError:
        return None
    expected = _unsubscribe_mac(secret, report_id, contact_id)
    if not hmac.compare_digest(expected.encode(), parts[2].encode()):
        return None
    return report_id, contact_id
