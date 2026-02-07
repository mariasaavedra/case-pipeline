# case-pipeline — Onboarding Checklist

This checklist is designed to onboard an engineer into the **concepts, architecture, and intent** behind the `case-pipeline` repo and the broader goal of building an internal Zapier/Retool-style automation platform.

Completion of this checklist means the person understands **what this repo does, why it exists, and how it fits into a larger system**.

---

## Phase 1 — Runtime & Execution Model (Bun)

**Goal:** Understand how this project runs as a deterministic, one-shot automation.

### Read
- Bun overview  
  https://bun.com/docs
- Bun runtime APIs  
  https://bun.com/docs/runtime/nodejs-apis

### Do
- [X] Install Bun
- [X] Run the project successfully (`bun run index.ts`)
- [X] Confirm an output file is generated
- [X] Add a console log showing total execution time

### Should Understand
- What a JS runtime is (vs a framework)
- Why Bun is used instead of Node
- How short-lived automation scripts execute

---

## Phase 2 — Environment-Based Configuration

**Goal:** Understand why configuration is externalized via `.env`.

### Read
- The Twelve-Factor App: Config  
  https://12factor.net/config
- Bun environment variables  
  https://bun.com/docs/runtime/env

### Do
- [X] Copy `.env.example` → `.env`
- [X] Identify which values are required vs optional
- [ ] Add a new env var (e.g. `RUN_MODE=dry-run`)
- [ ] Change script behavior based on that variable

### Should Understand
- Why secrets never live in code
- How this mirrors production automation systems
- Tradeoffs Zapier abstracts away

---

## Phase 3 — APIs & Connectors (Monday.com)

**Goal:** Understand how “connectors” work under the hood.

### Read
- Monday API authentication  
  https://developer.monday.com/api-reference/docs/authentication
- Monday GraphQL intro  
  https://developer.monday.com/api-reference/docs/introduction-to-graphql
- GraphQL basics  
  https://graphql.org/learn/queries/

### Do
- [X] Inspect the GraphQL query in `fetchMondayItem`
- [X] Add one additional column to the query
- [X] Log the raw API response
- [X] Add explicit error handling for missing columns

### Should Understand
- GraphQL vs REST
- API tokens and scopes
- What a “connector” is responsible for

---

## Phase 4 — Data Mapping & Transformation

**Goal:** Understand explicit mapping and why it is intentional.

### Read
- ETL fundamentals  
  https://www.ibm.com/topics/etl
- Why glue code matters  
  https://www.honeycomb.io/blog/why-glue-code-matters

### Do
- [ ] Modify `mapItemToTemplateVars`
- [ ] Rename one template variable end-to-end
- [ ] Add a derived field (e.g. formatted phone number)
- [ ] Add a default value strategy

### Should Understand
- Schema mismatch
- Why implicit mappings fail at scale
- Deterministic vs “magic” automations

---

## Phase 5 — Templating & Document Generation

**Goal:** Understand logic-light, versioned document generation.

### Read
- Handlebars guide  
  https://handlebarsjs.com/guide/
- Why Handlebars  
  https://handlebarsjs.com/guide/#why-handlebars

### Do
- [ ] Add a conditional section to the template
- [ ] Add a loop (hypothetical multiple notes)
- [ ] Split template into partials

### Should Understand
- Separation of logic and presentation
- Why templates belong in source control
- How this replaces no-code document builders

---

## Phase 6 — Automation Architecture Context

**Goal:** Understand where this repo fits in the larger platform.

### Read
- Zapier platform overview  
  https://platform.zapier.com/overview
- Retool mental model  
  https://docs.retool.com/docs
- Job queues (BullMQ example)  
  https://docs.bullmq.io/

### Do
- [ ] Diagram this script as a single “workflow step”
- [ ] Identify which logic belongs in:
  - connector
  - step
  - runner
  - UI
- [ ] Propose how retries would be implemented

### Should Understand
- Step-based automation
- Control plane vs execution plane
- Why internal tooling scales better than Zapier

---

## Phase 7 — Operational Thinking

**Goal:** Think like an automation platform owner, not a script author.

### Read
- Choose boring technology  
  https://boringtechnology.club/
- Alerting and failure modes  
  https://www.honeycomb.io/blog/stop-alerting-on-call/

### Do
- [ ] Identify all failure points in the script
- [ ] Decide which failures should page a human
- [ ] Add structured logs for each major step
- [ ] Propose where run history should live

### Should Understand
- Fail-fast systems
- Auditability and observability
- Automation as infrastructure

---

## Completion Criteria

Someone who completes this checklist should be able to:

- Explain exactly what this repo does
- Explain why it exists instead of Zapier
- Extend it safely
- Design the next workflow step
- Contribute meaningfully to the internal automation platform

---

## Optional Extensions

- Turn this script into a reusable CLI
- Add SharePoint as a second connector
- Add DOCX/PDF rendering
- Persist execution history to Postgres
- Define a YAML-based workflow spec
