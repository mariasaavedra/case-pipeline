# Auth, User Management & Custom Views

**Status:** Planned — not started  
**Last updated:** 2026-05-25

---

## Goal

Add a login system backed by Azure AD SSO (no additional cost — covered by existing M365 license) and a per-user preferences layer that lets each user customize their experience: saved filter sets, dashboard widget layout, table column choices, and a pinned client watchlist.

---

## Auth Decision

**Azure AD SSO (Microsoft Entra ID)**

- Users log in with the same Microsoft credentials they use for Outlook and SharePoint
- Backend validates Azure AD JWTs using `jwks-rsa` against Microsoft's public keys — no extra service or cost
- Uses the **existing Azure AD app registration** already set up for the SharePoint integration (`User.Read` permission already present)
- Frontend uses `@azure/msal-browser` + `@azure/msal-react` (PKCE flow)
- Stateless: no server-side sessions — Bearer token sent on every API request

**Roles:** Admin and User (two tiers)

- **Admin** — full access, can promote/demote other users, access `/admin` panel. Initially just the project owner; can be granted to technical staff later.
- **User** — everyone else (attorneys, paralegals, staff). Full read access to case data, full control over their own preferences and views.

---

## Database Strategy

A new **`data/users.db`** (gitignored) alongside the existing `seed.db` / `live.db`.

- Case data stays in `seed.db` / `live.db` (read-only connection, unchanged)
- User accounts, preferences, and saved views live in `users.db` (writable)
- User accounts persist regardless of which case DB is active (`DB_SOURCE=seed|live`)
- `users.db` is auto-created on first run; no manual setup needed

---

## Phase 1 — Authentication

### Schema (`users.db`)

```sql
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  azure_oid   TEXT UNIQUE NOT NULL,   -- Azure AD object ID (immutable)
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT
);
```

### Backend changes

**New dependencies:** `jsonwebtoken`, `jwks-rsa`

**New files:**
- `apps/api/src/auth/validate-token.ts` — validates Bearer JWT against Azure AD JWKS endpoint, returns decoded claims
- `apps/api/src/auth/middleware.ts` — Express middleware; rejects 401 if token missing/invalid, attaches user to request
- `apps/api/src/db/users-db.ts` — opens `users.db`, runs schema migrations, exports writable connection
- `apps/api/src/routes/auth.ts` — `GET /api/auth/me` (upserts user on first login, returns profile)
- `apps/api/src/routes/admin.ts` — `GET /api/admin/users`, `PATCH /api/admin/users/:id/role` (admin-only)

**Changes to existing files:**
- `apps/api/src/server.ts` — mount auth middleware on all `/api/*` routes; open `users.db` alongside case DB

### Frontend changes

**New dependencies:** `@azure/msal-browser`, `@azure/msal-react`

**New files:**
- `apps/web/src/auth/msal-config.ts` — MSAL config (tenant ID, client ID, scopes)
- `apps/web/src/auth/AuthProvider.tsx` — wraps app in `MsalProvider` + fetches `/api/auth/me` after login
- `apps/web/src/auth/useAuth.ts` — hook: `{ user, isAdmin, isLoading, login, logout }`
- `apps/web/src/pages/LoginPage.tsx` — "Sign in with Microsoft" button, redirects after auth
- `apps/web/src/pages/AdminPage.tsx` — user list, role toggle (admin-only)

**Changes to existing files:**
- `apps/web/src/main.tsx` — wrap app in `AuthProvider`
- `apps/web/src/app.tsx` — add route guard (redirect to `/login` if unauthenticated); add `/admin` route
- `apps/web/src/router.ts` — add `login` and `admin` pages to route union
- `apps/web/src/api.ts` — attach `Authorization: Bearer <token>` header to all fetch calls

### Before starting Phase 1 — required info

- [ ] Azure AD **tenant ID** (from the existing app registration)
- [ ] Azure AD **client ID** (from the existing app registration)
- [ ] Redirect URI to register: `http://localhost:5173` for dev; production URL if applicable

---

## Phase 2 — Preferences & Custom Views

### Schema (`users.db`)

```sql
CREATE TABLE user_preferences (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,  -- JSON
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE user_views (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,  -- 'filter_set' | 'column_config' | 'widget_layout' | 'watchlist'
  config      TEXT NOT NULL,  -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Preference keys (in `user_preferences`)

| Key | Type | Description |
|---|---|---|
| `dashboard_widgets` | JSON array | Widget visibility + order on landing page |
| `clients_columns` | JSON array | Visible columns + order in clients table |
| `appointments_columns` | JSON array | Visible columns in appointments table |
| `watchlist` | JSON array of localIds | Pinned client IDs |
| `sidebar_collapsed` | boolean | Sidebar state persistence |

### Backend

**New files:**
- `apps/api/src/routes/preferences.ts` — `GET /api/preferences`, `PUT /api/preferences/:key`
- `apps/api/src/routes/views.ts` — `GET /api/views`, `POST /api/views`, `PUT /api/views/:id`, `DELETE /api/views/:id`

### Frontend

**New files:**
- `apps/web/src/hooks/usePreferences.ts` — reads/writes user preferences, syncs to API
- `apps/web/src/hooks/useViews.ts` — CRUD for named saved views
- `apps/web/src/components/SavedViewsPanel.tsx` — dropdown/panel for loading/saving named views
- `apps/web/src/components/ColumnPicker.tsx` — reusable column visibility toggle
- `apps/web/src/components/WatchlistWidget.tsx` — pinned clients section (sidebar or landing page)

**Changes to existing files:**
- `apps/web/src/components/LandingPage.tsx` — widget show/hide + drag-to-reorder
- `apps/web/src/components/ClientsPage.tsx` — saved filter sets, column picker
- `apps/web/src/components/AppointmentsPage.tsx` — saved filter sets, column picker
- `apps/web/src/components/Sidebar.tsx` — watchlist section, persist collapse state

---

## Phase 3 — Admin Panel

Full `/admin` page:

- User list (name, email, role, last login)
- Role toggle (promote to admin / demote to user)
- Per-user preference reset ("clear customizations")
- Eventually: global default views that admin sets for new users

**Files:** `apps/web/src/pages/AdminPage.tsx` + `apps/api/src/routes/admin.ts` (started in Phase 1, expanded here)

---

## Open Questions / Blockers

- Azure AD tenant ID + client ID needed before Phase 1 can start
- Production URL (if any) needed for redirect URI registration
- Drag-to-reorder for widgets: evaluate `@dnd-kit/core` vs CSS-only approach at implementation time
