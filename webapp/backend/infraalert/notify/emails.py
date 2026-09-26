"""What citizen emails say. Plain, calm wording, matching the citizen site."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from html import escape

from infraalert.db.models import NotificationEvent
from infraalert.notify.mailer import Email

SNIPPET_LENGTH = 140


@dataclass(frozen=True)
class EventCopy:
    subject: str
    headline: str
    body: str


EVENT_COPY = {
    NotificationEvent.ASSIGNED: EventCopy(
        subject="Update on your InfraAlert report: a repair team is assigned",
        headline="A repair team is assigned",
        body="City staff have sent a team to deal with the problem you reported. "
        "The work is being scheduled.",
    ),
    NotificationEvent.RESOLVED: EventCopy(
        subject="Update on your InfraAlert report: the problem is fixed",
        headline="The problem is fixed",
        body="The team has finished the repair. Thank you for reporting it.",
    ),
    NotificationEvent.CLOSED: EventCopy(
        subject="Update on your InfraAlert report: closed without a repair",
        headline="Closed without a repair",
        body="City staff reviewed your report and closed it without sending a team, "
        "for example because the problem could not be found or is handled elsewhere. "
        "If the problem is still there, please report it again.",
    ),
}


def snippet(description: str) -> str:
    text = " ".join(description.split())
    if len(text) <= SNIPPET_LENGTH:
        return text
    return text[: SNIPPET_LENGTH - 1].rstrip() + "…"


def verification_email(to: str, base_url: str, report_id: uuid.UUID, token: str) -> Email:
    # The token goes in the fragment, which browsers never send to a server.
    link = f"{base_url}/reports/{report_id}/verify#token={token}"
    text = (
        "Hello,\n\n"
        "Someone asked for email updates on an InfraAlert report using this address.\n"
        "To confirm, open this link within 24 hours:\n\n"
        f"{link}\n\n"
        "We'll only email you when a repair team is assigned and when the report is "
        "resolved or closed.\n\n"
        "If this wasn't you, you can ignore this email and nothing more will be sent.\n\n"
        "InfraAlert\n"
    )
    html = _html(
        "Confirm email updates",
        "<p>Someone asked for email updates on an InfraAlert report using this address.</p>"
        f'<p><a href="{escape(link)}">Confirm email updates</a> (the link works for 24 hours)</p>'
        "<p>We'll only email you when a repair team is assigned and when the report is "
        "resolved or closed.</p>"
        "<p>If this wasn't you, you can ignore this email and nothing more will be sent.</p>",
    )
    return Email(
        to=to, subject="Confirm email updates for your InfraAlert report", text=text, html=html
    )


def update_email(
    to: str,
    base_url: str,
    report_id: uuid.UUID,
    description: str,
    event: NotificationEvent,
    unsubscribe_token: str,
) -> Email:
    copy = EVENT_COPY[event]
    report_link = f"{base_url}/reports/{report_id}"
    unsubscribe_link = f"{base_url}/unsubscribe#token={unsubscribe_token}"
    quoted = snippet(description)
    text = (
        f"{copy.headline}\n\n"
        f"Your report: “{quoted}”\n\n"
        f"{copy.body}\n\n"
        f"See your report: {report_link}\n\n"
        "—\n"
        "You're getting this because you asked for updates on this report.\n"
        f"Stop these emails: {unsubscribe_link}\n"
    )
    html = _html(
        copy.headline,
        f"<p>Your report: “{escape(quoted)}”</p>"
        f"<p>{escape(copy.body)}</p>"
        f'<p><a href="{escape(report_link)}">See your report</a></p>'
        '<hr style="border:none;border-top:1px solid #ddd">'
        '<p style="color:#666;font-size:13px">'
        "You're getting this because you asked for updates on this report. "
        f'<a href="{escape(unsubscribe_link)}" style="color:#666">Stop these emails</a></p>',
    )
    return Email(to=to, subject=copy.subject, text=text, html=html)


def _html(heading: str, body: str) -> str:
    return (
        '<!doctype html><html><body style="font-family:system-ui,sans-serif;'
        'line-height:1.5;color:#222;max-width:560px;margin:0 auto;padding:16px">'
        f'<h1 style="font-size:20px">{escape(heading)}</h1>{body}'
        '<p style="color:#666;font-size:13px">InfraAlert</p></body></html>'
    )
