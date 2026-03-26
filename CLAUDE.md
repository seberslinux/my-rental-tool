# My Rental Tool

Short-term rental management app with Smoobu integration. Built with React (Vite) frontend and Express/Node backend, deployed on Railway.

## Project Structure

```
client/          # React frontend (Vite + TypeScript)
  src/
    components/  # Page components (AnalyticsPage, PropertiesPage, etc.)
    data/        # Data fetching and state (analytics.ts, properties.ts, etc.)
  dist/          # Built frontend (served by Express, do not edit)
src/
  routes/        # Express API routes
  services/      # Business logic (smoobu, exchange-rates, etc.)
  db/            # Database (PostgreSQL, migrations)
  middleware/    # Auth, property scoping
server.js        # Express entry point
```

## Local Development Setup

### Prerequisites
- Node.js, npm
- Railway CLI (`brew install railway`)
- Linked to Railway project (`railway link`)

### Running locally

**Option A — Hot reload (recommended for frontend work):**
```bash
# Terminal 1: Vite dev server with hot reload
cd client && npm run dev

# Terminal 2: Backend with Railway env vars
railway run npm start
```
Open `http://localhost:5173` (Vite proxies API calls to the backend).

**Option B — Production-like build:**
```bash
cd client && npm install && npm run build
railway run npm start
```
Open `http://localhost:3000`.

### After frontend changes
Run `/rebuild` in Claude Code, or manually:
```bash
cd client && npm install && npm run build
```
Then restart the backend.

### After backend changes
Just restart `railway run npm start`.

## Git Workflow

### Branches
- `master` — production. Merging here triggers Railway deploy.
- Feature branches: `feature/short-description` (e.g. `feature/net-revenue-chart`)
- Bug fixes: `fix/short-description` (e.g. `fix/commission-save-bug`)
- Refactors: `refactor/short-description`

### Process
1. Create a branch from `master`: `git checkout -b feature/my-feature`
2. Make changes, commit with clear messages
3. Push and open a PR: `git push -u origin feature/my-feature`
4. Review, then merge to `master`
5. Do NOT push directly to `master`

### Commit messages
- Start with what the commit does: `Add ...`, `Fix ...`, `Update ...`, `Refactor ...`
- Keep the first line under 72 characters
- Add a blank line + details if needed

### Examples
```
Add gross/net revenue toggle on monthly trend chart
Fix property commission save bug (field name mismatch)
Update VAT calculation to be per-platform
```

## Database

- PostgreSQL on Railway
- Migrations run automatically on server start (`src/db/migrations.js`)
- Schema changes: add new columns in `migrations.js` — they are added idempotently via `ALTER TABLE ADD COLUMN IF NOT EXISTS`

## Deployment

Push/merge to `master` → Railway auto-deploys. No manual steps needed.

## Key Conventions

- Currency is displayed in ZAR (South African Rand) with `R` prefix
- Commission, bank charges, and VAT rates are configured per-property per-platform
- Net revenue = gross - commission - bank charges - VAT (where VAT is on commission + bank charges)
- Smoobu is the source of truth for bookings and properties (synced via API)
