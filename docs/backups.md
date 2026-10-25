# Backups and restore

## What is backed up, and where

| Copy | When | Where | Kept |
|---|---|---|---|
| `live-<stamp>.db.enc`, `users-<stamp>.db.enc` | Daily, 05:30 Central (`BACKUP_CRON`) | `data/backups/` on the server | `BACKUP_KEEP` (4) |
| The same two files | Right after a verified, encrypted daily backup, when `BACKUP_OFFSITE=on` | SharePoint: site `BACKUP_OFFSITE_SITE`, folder `BACKUP_OFFSITE_PATH` | `BACKUP_OFFSITE_KEEP` (7) |
| `live-presync-<stamp>.db` | Before every full sync | `data/backups/` | a few |
| `live-premigrate-v<N>-…` | Before a schema migration | `data/backups/` | a few |

Much of the data exists only in these files, not in Monday: the audit log, staff roster, SMS log, payment links, LawPay events, mail scans, e-sign agreements, client-upload ledger and item history. That's why a copy goes off the server (audit 2026-10-24, H2).

## The keys

The `.enc` files are AES-256-GCM, encrypted with `BACKUP_ENCRYPTION_KEY`. Inside `users.db`, Monday OAuth tokens are also encrypted with `APP_ENCRYPTION_KEY`. **Both keys must be in the firm's password manager.** A backup on SharePoint is useless if the only copy of its key was on the lost server.

## Turning the off-site copy on

1. On the server, the Graph sign-in the consult sweep uses must exist (`npm run sharepoint:folders -- --login`, once).
2. In `.env`, set `BACKUP_OFFSITE_SITE=<site name>` (and `BACKUP_OFFSITE_PATH` if not `App Backups/case-pipeline`).
3. Do a dry run: `docker exec <api> npm run backup:offsite`. It lists what it would upload and delete.
4. Set `BACKUP_OFFSITE=on` and restart the API. From the next 05:30 run on, each verified, encrypted backup is copied. A failure posts to the Slack ops channel.

Only `live-…db.enc` / `users-…db.enc` are ever uploaded. An unencrypted backup is refused, and so is any other file.

## Restore

1. Get the file: download the newest `live-….db.enc` (and `users-….db.enc`) from the SharePoint folder, or take it from `data/backups/`.
2. Decrypt it: `BACKUP_ENCRYPTION_KEY=… npx tsx scripts/restore-backup.ts live-….db.enc live.db` (never overwrites an existing file).
3. Check it: `sqlite3 live.db "PRAGMA quick_check"` must print `ok`.
4. Swap it in: `docker compose down`. Move `data/live.db`, `-wal` and `-shm` aside. Put the restored file at `data/live.db` (owned by uid 1000). Then `docker compose up -d`. The next sync brings Monday's data current. Data that exists only in the app stays as of the backup.
5. For users.db, follow the same steps, with the same `APP_ENCRYPTION_KEY` in `.env`, or every Monday connection must be redone.

Do a restore drill from SharePoint now and then, onto a laptop, not the server.
