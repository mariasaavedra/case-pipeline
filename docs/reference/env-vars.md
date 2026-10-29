# Environment variables

Moved out of `CLAUDE.md` (2026-10-29) so sessions don't load it every turn. Add a row here when you add one.

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `MONDAY_API_TOKEN` | Yes (live data) | Monday.com API token |
| `ITEM_ID` | Yes (render pipeline) | Item ID to render a document for |
| `TEMPLATE_NAME` | No (default: `client_letter`) | Template name from `config/templates.yaml` |
| `OUTPUT_DIR` | No (default: `output`) | Output directory for rendered files |
| `PROFILES_BOARD_ID` | No | Override board ID from `config/boards.yaml` |
| `CONTRACTS_BOARD_ID` | No | Override board ID from `config/boards.yaml` |
| `MONDAY_API_VERSION` | No (default: `2024-10`) | Monday.com API version |
| `FEE_K_AUTOFILL` | No | `on` fills empty Fee K columns on Monday every 15 min: POC Full Name from the Jail Intake, AF/FF Surcharge (3%) when paid by credit card, "It will go to…" from the Fee K Types table (Settings → Firm). Needs `FEE_K_AUTOFILL_SINCE`. See `docs/features/fee-k-autofill.md` |
| `MONDAY_WEBHOOK_SECRET` | No | Enables the Monday webhook receiver + processor (near-real-time mirror refresh). See `docs/webhooks.md` |
| `SLACK_MODE` | No (default `off`) | `dry-run` logs what it would post; `on` posts with `SLACK_BOT_TOKEN` (`xoxb-`) to `SLACK_EVENTS_CHANNEL` (contract signed / payment link sent, consult prepped, consult ready (queued, P17 Slack Queue), mail to review, texts sent, Adobe Sign, client uploads) and `SLACK_OPS_CHANNEL` (sync / job / Monday-write failures, max 1 per kind per hour). Channel ids, not names. Sender = `apps/api/src/notify/slack.ts`. See `docs/features/sms-and-slack.md` |
| `SMS_MODE` | No (default `off`) | `dry-run` records texts without sending; `on` sends through RingCentral and needs `RINGCENTRAL_CLIENT_ID` / `_CLIENT_SECRET` / `_JWT` / `_FROM_NUMBER` (E.164). Seed data is always dry-run. See `docs/features/sms-and-slack.md` |
| `ZAPIER_ESIGN_HOOK_URL` / `ZAPIER_ESIGN_SECRET` | No | Both set (+ `API_URL`) = M22 "Send for signature": contracts to Adobe Sign through 3 Zaps. See `docs/features/esign-zapier.md` |
| `SLACK_WEBHOOK_URL` | No | Slack Incoming Webhook for contract alerts (signed / rejected / expired / recalled) |
| `LAWPAY_SLACK` | No | `on` reads LawPay payments from the "Payment Bot" posts in Slack #payments (`LAWPAY_SLACK_CHANNEL`, default C0922BS65LM) every 2 min with `SLACK_BOT_TOKEN` and updates the Fee Ks. Check first: `npm run lawpay:slack` (read-only). See `docs/features/lawpay-payments.md` |
| `BUZON_AUTO` | No | `on` (+ required `BUZON_AUTO_SINCE=YYYY-MM-DD`, with `CLIENT_UPLOADS=on`): a Fee K reaching "Paid needs action" since that date gets its Fee K Type's document list on the client's Buzón and the link texted (unless the client is set to no automatic texts — then staff are told). Reminders / "we received" texts are switched in Settings → Firm → Buzón texts; resending a link needs `APP_ENCRYPTION_KEY`. Job every 5 min (`BUZON_CRON`). See `docs/features/buzon.md` |
| `LAWPAY_MAIL` | No | `on` reads LawPay receipt e-mails forwarded to importantdocuments@ every 10 min (`LAWPAY_MAIL_CRON`) and updates the Fee Ks. Needs `npm run lawpay:mail -- --login` once (adds Mail.Read). See `docs/features/lawpay-payments.md` |
| `BACKUP_OFFSITE` | No | `on` copies each verified, encrypted daily backup (`live-…db.enc` + `users-…db.enc`) to SharePoint (`BACKUP_OFFSITE_SITE`, `BACKUP_OFFSITE_PATH`, keep `BACKUP_OFFSITE_KEEP` = 7) with the consult sweep's Graph sign-in. Check first: `npm run backup:offsite` (dry run). Both encryption keys belong in the password manager. See `docs/backups.md` |
