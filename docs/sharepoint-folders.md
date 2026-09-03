# SharePoint folder automation

Creating folders in SharePoint from a script, as the app rather than as a person.

## Auth: device code on the existing app registration

No new API permission and no client secret. The dashboard's app registration
(`2b0a7d88-6a8b-4913-90a7-9926fd8f6335`) already holds an admin-consented
**delegated** `Files.ReadWrite.All` grant, in daily use by the Documents tab.
This signs in as a real person once via the device code flow and keeps the
refresh token, so scheduled runs need no browser.

**Setup is one toggle**, already done: App registration → Authentication →
*Allow public client flows* → **Yes**.

Then sign in once:

```bash
npm run sharepoint:folders -- --login
```

It prints a URL and a code. Enter them in a browser, sign in, done.
`--logout` forgets the sign-in.

### What this means operationally

- **Everything runs as that person.** The script can only touch what they can
  already touch in SharePoint. A 403 means *their* access is missing, not the
  app's. This is a lower ceiling than app-only, deliberately.
- **The sign-in is not eternal.** Entra expires an unused refresh token after
  ~90 days, and Conditional Access can cut it shorter. When it lapses the next
  run fails with a clear instruction to re-run `--login` — it does not silently
  stop. Refresh tokens rotate on every use, and the new one is persisted, so a
  regularly-running sweep keeps itself alive.
- **The refresh token is a credential.** It is written to
  `data/.graph-token.json` (gitignored) with owner-only permissions, encrypted
  at rest when `APP_ENCRYPTION_KEY` is set — the same helper that protects
  Monday OAuth tokens. Treat it like a password: it is a bearer credential for
  that person's files.

### If you later want it fully unattended

Set `GRAPH_CLIENT_SECRET` in `.env` and the script switches to app-only
(client credentials) with no other change. That path needs an **application**
permission on the registration — `Sites.Selected` plus a per-site grant is far
narrower than tenant-wide `Sites.ReadWrite.All` — and admin consent. The code
for it is already in `scripts/sharepoint/auth.ts`.

## Usage

```bash
# Verify the app can see a site at all (read-only, safe)
npm run sharepoint:folders -- --site=scalefiles --check

# Dry run — resolves and reports, writes nothing
npm run sharepoint:folders -- --site=scalefiles --path="ZZ Pipeline Test/Correspondence"

# Actually create it
npm run sharepoint:folders -- --site=scalefiles --path="ZZ Pipeline Test/Correspondence" --apply
```

Writes require `--apply`. Everything is idempotent: an existing folder is
reused, never replaced or renamed.

## Design notes

- **`conflictBehavior=fail`, not `rename`.** A re-run must not scatter
  `Correspondence 1`, `Correspondence 2` through client e-files. A 409 is
  caught and treated as "already there" — which also covers losing a race with
  a person working in the SharePoint UI.
- **No delete, no move.** There is deliberately no such helper in
  `scripts/sharepoint/folders.ts`.
- **An existing *file* where a folder should be** raises rather than being
  worked around.
- **Throttling is obeyed.** Graph returns 429/503 with `Retry-After` under bulk
  load; `graph-app.ts` honours it and backs off. Ignoring it gets the app
  throttled harder.
- **Names are validated before the call** against SharePoint's rules (`" * : <
  > ? / \ |`, trailing period, reserved names) so a bad client name fails with
  a clear message instead of a Graph 400.

## Files

| Path | Purpose |
|---|---|
| `scripts/sharepoint/graph-app.ts` | App-only token + throttle-aware fetch |
| `scripts/sharepoint/folders.ts` | `ensureFolder` / `ensureFolderPath` primitives |
| `scripts/sharepoint/folders.test.ts` | Unit tests (stubbed Graph, no network) |
| `scripts/sharepoint-folders.ts` | CLI |

---

# Consult folder automation

Replaces the Calendly→Zapier automation that broke when Zapier lost the ability
to skip an already-existing folder.

## Trigger

An item on **Appointments R / LB / M** whose **"Calendly?"** status
(`status_1_Mjj3Ia2N`, label `yes`) is set, and which is linked to a profile
(`connect_boards4__1`). All three boards share the same column ids.

## What it produces

```
SCAL Consults / Shared Documents / {YYYY} Consults / {initial} / {LASTNAME, Firstname}
```

- `{YYYY}` — year of the appointment's **Consult Date** (`date3__1`)
- Surname upper-cased, given name as typed
- Name comes from the profile's **First Name** / **Last Name** columns
  (`text_mm3s5gxk` / `text_mm3seg3p`), with bracketed asides stripped

The URL is written back to the profile's **Consult File** column
(`text_mkxphk77`) — a plain text column, and therefore writable. The
`Consult File` mirror on each appointment board (`lookup_mkxpm30e` on
Appointments M, and its siblings) is a **mirror and cannot be written**; it
fills itself from the profile once the profile column is set.

## Stages

| Stage | Command | Touches |
|---|---|---|
| 1. Plan | `npm run consult:folders -- --db=live` | Nothing. Reads `live.db` |
| 2. Match | `… --match` | SharePoint, read-only. Full scan of all three sites |
| 3. Link | `… --match --link --apply` | Writes URLs of folders that already exist |
| 4. Create | `… --match --create --year=YYYY --apply` | Creates missing folders, records them |
| Confirmed | `… --link-file=config/consult-folder-links.json --apply` | Records pairings a person confirmed |
| **Sweep** | `npm run consult:sweep -- --apply` | **The automated trigger.** Targeted, safe to run often |

## The sweep (the automated trigger)

`npm run consult:sweep` is what replaces Zapier. Scheduled by the API when
`CONSULT_FOLDERS=on` (see `.env.example`), it runs `:30` past every second hour
during the working day, after the incremental sync.

For each Calendly consultation in the last `CONSULT_SWEEP_DAYS` days:

1. **Skip** if a link is already recorded — costs zero API calls, which is why
   this is cheap to run often.
2. **Skip** unless the consult actually took place. Cancelled, no-show and
   still-upcoming are left alone, and an unrecognised status is skipped rather
   than assumed (`consult-status.ts`).
3. **Skip** if the name needs a human — a missing first name, a surname that is
   really an A-number, a reversed entry.
4. **Look** for the folder at three exact paths, most-advanced first: SCAL
   Closed, then E-Files, then Consults. A client who has hired or closed must
   never be given a fresh consult folder.
5. **Link** it if found, recording to E-File or Consult File depending on where
   it lives. Otherwise **create** it in SCAL Consults and record it.

Deliberately targeted rather than the full scan `--match` does: a sweep looks at
a few days of consults, where the folder is either at the expected path or does
not exist, so three cheap lookups answer it.

**Before writing, it re-reads the column from Monday.** `live.db` lags Monday by
up to a sync interval, so a link entered by hand ten minutes ago is invisible to
the query — checking first means the sweep can never clobber a fresher value.
This is not theoretical: the first live run found two candidates from stale
local data, checked Monday, and correctly wrote nothing.

Stage 1 exists because the naming rule is the risky part: a wrong name does not
fail, it quietly creates a second folder beside a client's real one. Stage 2
exists because most of the backlog is 2025, where the folders very likely
already exist and were simply never recorded in Monday.

## Names the rule refuses

`consultFolderName` refuses rather than guessing when the surname is missing,
empty once cleaned, or not alphabetic (an A-number left behind after stripping
brackets, a `+`-joined multi-person entry). Refused rows appear on the plan
report as `review` and need a person to fix the name in Monday. On live data
this is ~3% of consults.
