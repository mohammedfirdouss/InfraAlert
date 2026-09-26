---
status: accepted
---

# Anonymous-by-default citizens; staff sign in via SSO

**Citizens** can submit anonymously. Anonymous submissions are protected by a CAPTCHA and rate limits, and the citizen gets a status link. Anyone who wants updates must verify their contact first, by email magic link (preferred, as it's cheaper) or SMS code. This stops the service from texting numbers someone typed in without verifying. Contact details are personal data: they're stored apart from reports and deleted after a retention period.

**Staff** sign in through the city's existing identity provider via Google Identity Platform, designed against generic OIDC because the provider isn't known yet. Roles (`dispatcher`, `supervisor`, `admin`) live in our database. We never store staff passwords, MFA comes from the provider, and people who leave lose access when their city account is disabled.

## Considered Options

- **Required citizen accounts**: a barrier for a civic service.
- **Unverified phone numbers** (the original design): lets anyone make the city text a stranger, and costs money per message.
- **Identity-Aware Proxy for staff**: ties us to a Google load balancer, and awkward when citizen and staff routes live in one service.

## Consequences

- Access comes from our `staff` table, never from the identity provider alone. Admins invite
  people by email; the identity provider's subject is linked on that person's first sign-in,
  and a valid sign-in for anyone not invited gets "not staff". The first admin is created with
  `python -m infraalert.cli create-admin`.
- The last active admin can't be demoted or deactivated, so the city can't lock itself out.
