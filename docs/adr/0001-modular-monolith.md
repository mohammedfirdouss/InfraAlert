---
status: accepted
---

# Replace the agent microservices with a modular monolith

InfraAlert began as six services: an orchestrator, four "agents" (issue detection, priority analysis, resource coordination, platform integration) and an MCP server. It will be built and run by one small team, and none of the stages needs to scale on its own. The orchestrator also called them in a fixed order, so there was nothing agentic about the split. We are merging them into a single FastAPI service. Detection, priority, dispatch and notify become modules with clear interfaces. The MCP server and the Google ADK `SequentialAgent` wrapper are deleted.

## Considered Options

- **Keep the services**: only worth it with several teams deploying separately. For us it meant four network hops, four places to fail, and six services' worth of deployment, secrets and IAM.
- **Keep MCP as a thin adapter over the domain layer**: deferred. Nothing called it. Its write tools (e.g. `assign_team_to_report`) would get around human dispatch ([0005](./0005-human-in-the-loop-dispatch.md)) and the audit log. A read-only MCP adapter for staff can be added later if someone asks for it.

## Consequences

- A module is split back into its own service only when a real team boundary or scaling need appears.
