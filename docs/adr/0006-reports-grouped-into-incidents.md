---
status: accepted
---

# Reports are grouped into incidents

Citizens submit **reports**; teams fix **incidents**. Every report belongs to exactly one incident. During processing, a report is attached to an open incident of the same issue type within a small radius (PostGIS proximity), or it starts a new one. That match is only a suggestion, which dispatchers can merge or split. Priority, assignment, status and notifications are all per incident. The number of reports feeds into priority, and every reporter is told when the incident is resolved. Adding incidents later would mean moving assignments and statuses off reports, so we decided this up front.

## Considered Options

- **Reports only**: twenty reports of one burst main flood the queue, and the report count is lost as a priority signal.
- **Automatic merging with no human check**: two potholes 40m apart are separate jobs, and a misclassified report would fail to match anyway.
