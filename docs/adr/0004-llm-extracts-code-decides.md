---
status: accepted
---

# The LLM extracts facts; code decides priority and dispatch

Gemini is called **once** per report, with a structured-output schema. It reads the description and photos, and returns the issue type, hazard flags, a summary and a confidence. Priority is a deterministic, versioned formula over issue type, hazard flags, proximity to sensitive places and report count. The suggested team comes from a deterministic query: the nearest available team whose skills match the issue type. The city has to be able to explain, test and replay priority and dispatch decisions, and an LLM choosing crews or blending in a vague "time sensitivity" number gives none of that. Don't "improve" this by handing those decisions back to the model.

## Considered Options

- **LLM in every step** (the original design: classify, score and pick the team, three calls per report): can't be audited or repeated, and costs three times as much.
- **No LLM** (citizen picks the type from a dropdown): loses the photo and free-text understanding, which is where the model is actually useful.

## Consequences

- If Gemini fails or returns low confidence, the report goes to **needs triage** for a human. There is no keyword-guessing fallback.
- Every incident stores the formula version and its input breakdown, so "why is this ranked here?" can always be answered. Weights are code constants for now.
- The incident's age is applied when sorting the queue and is never stored in the score.
- Cloud Vision is dropped because Gemini reads the images directly.
