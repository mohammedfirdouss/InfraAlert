---
status: accepted
---

# Process reports asynchronously via Cloud Tasks

Submitting a report used to run the whole pipeline inside the citizen's request (up to 60s). A slow LLM made submission fail, and a report was lost if the instance restarted. Now the submit endpoint only validates the report, saves it with status `received`, enqueues a Cloud Task and returns `202` with the report ID. A Cloud Tasks push to an internal endpoint on the same service runs the processing steps, with retries and a dead-letter path. The rule: **accepting a report never depends on an external API being up.**

## Considered Options

- **Synchronous**: simplest, but submission fails whenever Gemini is down.
- **In-process background task**: loses work when the instance restarts, and Cloud Run throttles CPU after the response is sent.

## Consequences

- Every processing step must be safe to retry. Everything is keyed on the report ID, and team assignment is a guarded conditional update.
- The citizen UI polls a status link instead of waiting for a result.
