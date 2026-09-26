# InfraAlert

A city service where citizens report infrastructure problems and city staff triage, prioritize and dispatch teams to fix them.

## Citizen side

**Citizen**:
A member of the public who submits reports. They may be anonymous or have a verified contact.
_Avoid_: User, reporter (as a noun for the person), customer

**Report**:
A single citizen's submission describing a problem at a specific point on the map, optionally with photos.
_Avoid_: Ticket, complaint, issue (for the submission itself)

**Report status**:
The progress a citizen sees on their report (received, under review, team assigned, in progress, resolved, closed). It follows the report's incident but hides staff-only detail such as triage, merges and which team was sent.
_Avoid_: Incident status (that is the staff-side state)

**Verified contact**:
An email address or phone number that a citizen has proven they control, and the only kind the service ever sends messages to.
_Avoid_: Citizen phone

## The work

**Incident**:
One real-world problem that teams fix, made up of one or more reports of it. It is the unit that is prioritized, assigned and resolved.
_Avoid_: Issue, case, job, work order (reserved for an external system's record)

**Issue type**:
The category of an incident's problem (pothole, water leak, sewage, …).
_Avoid_: Report type, category

**Hazard flag**:
A named danger signal found in a report, such as injury or blocking traffic, that raises priority.
_Avoid_: Urgency keyword, severity keyword

**Extraction**:
The machine reading of a report into issue type, hazard flags, summary and confidence. It states facts about the report and never decides anything.
_Avoid_: Analysis, classification (for the whole step), detection

**Needs triage**:
The state of a report or incident whose extraction failed or wasn't confident enough, so a human has to classify it.

**Sensitive place**:
A location, such as a hospital, school or major road, whose nearness raises an incident's priority.

**Priority score**:
An incident's ranking value, computed by a versioned formula from its issue type, hazard flags, nearby sensitive places and report count.
_Avoid_: Urgency, time sensitivity

**Severity**:
A band (LOW, MEDIUM, HIGH, CRITICAL) that a priority score falls into.

## Dispatch

**Team**:
A city field group with skills for certain issue types, which fixes incidents. A team is available when it has no open assignment.
_Avoid_: Crew, unit, resource

**Suggested team**:
The team the system proposes for an incident, which a dispatcher may accept or override.

**Assignment**:
A dispatcher's decision to send a team to an incident. It records whether the suggestion was overridden.
_Avoid_: Dispatch (as a noun)

**Override**:
An assignment where the dispatcher picked a team other than the suggested team.

**Merge / Split**:
A dispatcher correcting which incident a report belongs to: joining separate incidents into one, or moving reports out into a new incident.

**Resolved**:
The state of an incident whose problem a team has fixed.
_Avoid_: Closed, done (closed also covers duplicate and invalid)

## Staff

**Staff**:
City employees who sign in to the dashboard. Each holds one role.
_Avoid_: Admin (as a general term), operator

**Dispatcher**:
A staff role that triages, merges or splits, assigns, and records status changes for incidents.

**Supervisor**:
A staff role with everything a dispatcher can do, plus managing teams and viewing statistics.

**Admin**:
A staff role that manages staff and sensitive places.
