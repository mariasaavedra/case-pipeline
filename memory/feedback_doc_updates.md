---
name: Update docs after every plan
description: After completing any implementation plan or phase, the final step is always updating all affected documentation
type: feedback
---

After every plan or feature phase is executed, always perform a final documentation pass as the last step.

**Why:** Documentation drifts from reality as features are built — paths change, commands change, new boards/features get added. Keeping docs current after each plan prevents the kind of staleness found during the 2026-05-09 audit (REFERENCE.md still describing pre-monorepo Bun setup, CONFIG-ARCHITECTURE.md with wrong commands, sitemap with wrong tab count, etc.).

**How to apply:** At the end of any implementation task, review and update: CLAUDE.md, README.md, docs/CONFIG-ARCHITECTURE.md, docs/sitemap.md, docs/features/*, docs/monday-domain-map.md, docs/next-steps.md, and docs/decisions.md — whichever files are affected by the changes just made. Delete plan docs that have been fully executed.
