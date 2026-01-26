# case-pipeline

A prototype slice of a larger internal automation platform (Zapier/Retool-style), starting with one high-value workflow: generating documents from Monday.com data and templates.

This repository exists to validate the end-to-end execution path that will eventually power an internal workflow engine, replacing Zapier for critical, high-impact automations.

---

## Positioning

**Today:**  
Zapier handles a large portion of business-critical workflows.

**Goal:**  
Build an internal automation platform that:

- Centralizes credentials and connector logic
- Version-controls workflows and transformations
- Provides execution history, retries, and observability
- Supports human-in-the-loop steps and approvals
- Integrates deeply with internal systems (Monday, SharePoint, etc.)

This repository is the smallest viable “workflow unit” proving that direction.

---

## What This Repo Does (Current State)

Workflow: **Render client confirmation document**

1. Load configuration from environment variables
2. Fetch a single Monday item via GraphQL
3. Map Monday column values to template variables
4. Render a Handlebars template
5. Write a timestamped artifact to disk

No UI. No scheduler. No background services.  
One deterministic run → one artifact.

---

## What This Repo Intentionally Does *Not* Do

These concerns belong to the future platform, not this prototype:

- Credential vaulting or token rotation
- Scheduling, webhooks, or event triggers
- Retries, backoff, idempotency
- Multi-step orchestration or branching
- Persistent execution state/history
- Role-based access control
- Visual workflow builders or approval UIs

---

## Prerequisites

- **Bun** runtime  
  https://bun.com

- **Monday.com API access**  
  https://developer.monday.com/api-reference/docs/authentication

Node.js is not required.

---

## Install

```bash
bun install
```

## Run

```bash
bun index.ts
```


On success:

The Monday item is fetched

Template variables are logged

A rendered file is written to /output

