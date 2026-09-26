---
status: accepted
---

# Private photo storage and Gemini via Vertex AI

Citizen photos can show faces, licence plates and the inside of homes. The browser uploads them straight to a private Cloud Storage bucket via signed upload URLs. Staff view them via short-lived signed URLs, and photos are deleted after a retention period. Gemini is called through Vertex AI (the `google-genai` SDK) using the service's own service account, and reads photos from `gs://` directly. This removes the long-lived API key, keeps Google Cloud's data terms and a chosen region, and ends server-side fetching of URLs supplied by citizens (an SSRF risk in the original Vision step).

## Consequences

- Blurring faces and plates before staff see photos is deferred until a city's privacy office asks for it.
