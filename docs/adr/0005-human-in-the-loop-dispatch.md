---
status: accepted
---

# The system suggests; a human dispatches

The system computes priority and a suggested team, but a staff dispatcher confirms or overrides every assignment. Sending a real team is a city decision that a named person has to own. Humans also catch duplicates and misclassifications that automation would act on blindly. Every override is recorded, and that record is the evidence for later moving low-risk categories to automatic dispatch.

## Considered Options

- **Fully automatic dispatch**: no accountable person, and it acts on the LLM's misclassifications and on duplicates.
- **Hybrid by severity**: postponed until override rates show which categories are safe to automate.

## Consequences

- There is a staff dashboard (sign-in, queue, merge/split, assign, status changes), and every state change is written to an audit log with the person who made it.
- For now, dispatchers relay jobs to teams (radio or phone) and record status changes on their behalf. A team's availability comes from its open assignments and is never stored as a flag.
- Citizens are told "assigned" only after a human confirms.
- The report form tells people with emergencies (gas leak, injury) to call emergency services instead.
