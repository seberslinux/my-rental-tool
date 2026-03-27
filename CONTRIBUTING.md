# Contributing to My Rental Tool

Welcome! This guide will walk you through everything you need to get started, even if you've never worked on a coding project before. Follow the steps in order and you'll be up and running.

---

## Table of Contents

1. [What is This Project?](#what-is-this-project)
2. [What You'll Need to Install](#what-youll-need-to-install)
3. [Getting the Code](#getting-the-code)
4. [Connecting to the Database](#connecting-to-the-database)
5. [Installing Dependencies](#installing-dependencies)
6. [Running the App Locally](#running-the-app-locally)
7. [Making Changes](#making-changes)
8. [Saving Your Work (Git)](#saving-your-work-git)
9. [Submitting Your Changes (Pull Requests)](#submitting-your-changes-pull-requests)
10. [Code Review](#code-review)
11. [How the Project is Organised](#how-the-project-is-organised)
12. [Coding Style Guide](#coding-style-guide)
13. [Database Changes](#database-changes)
14. [How Deployment Works](#how-deployment-works)
15. [Important Business Rules](#important-business-rules)
16. [Troubleshooting](#troubleshooting)

---

## What is This Project?

My Rental Tool is a web app for managing short-term rental properties. It connects to **Smoobu** (a booking platform) and helps with:

- Viewing and managing bookings across properties
- Tracking revenue, commissions, and financial analytics
- Scheduling and managing cleaners
- Pricing and maintenance tracking

The app has two parts:

| Part | What it does | Technology |
|---|---|---|
| **Frontend** (what users see) | The website interface — buttons, pages, charts | React, TypeScript, Tailwind CSS |
| **Backend** (behind the scenes) | Handles data, talks to the database and Smoobu | Node.js, Express |

Both parts run together to make the full app work.

---

## What You'll Need to Install

Before you start, you need three things on your computer. Here's how to install each one:

### 1. Node.js (the engine that runs the app)

Go to [https://nodejs.org](https://nodejs.org) and download the **LTS** (Long Term Support) version. Run the installer and follow the prompts. This also installs **npm** (Node Package Manager), which we use to install libraries.

To verify it worked, open **Terminal** (on Mac: search for "Terminal" in Spotlight) and type:

```
node --version
```

You should see a version number like `v20.x.x`. If you see "command not found", restart Terminal and try again.

### 2. Git (tracks changes to the code)

Git is probably already installed on your Mac. Check by typing:

```
git --version
```

If it's not installed, macOS will prompt you to install the Command Line Tools — follow the prompts.

### 3. Railway CLI (connects to our database and services)

Railway is where our database and app are hosted. Install the CLI (command-line tool) by typing:

```
brew install railway
```

> **Don't have Homebrew?** Install it first by pasting this into Terminal:
> ```
> /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
> ```
> Then run the `brew install railway` command above.

After installing, log into Railway:

```
railway login
```

This will open a browser window — log in with the account that has access to the project. Ask the project owner to invite you if you don't have access.

---

## Getting the Code

**First time only** — download the project to your computer:

```
git clone https://github.com/seberslinux/my-rental-tool.git
cd my-rental-tool
```

This creates a folder called `my-rental-tool` with all the code inside.

---

## Connecting to the Database

The app needs a database to work. We use Railway to manage it — you don't need to install a database on your computer.

From inside the `my-rental-tool` folder, run:

```
railway link
```

This connects your local folder to the Railway project. You'll be prompted to select the project and environment — pick the right one (ask the project owner if unsure).

You only need to do this once.

---

## Installing Dependencies

Dependencies are libraries (pre-written code) that the project needs to run. Install them all with one command:

```
npm run setup
```

This installs everything for both the backend and the frontend. You'll see a lot of text scrolling by — that's normal. Wait until you see `--- Setup complete! ---`.

> **When to run this again:** Only when you pull new changes that add new libraries, or if something seems broken. It's safe to run anytime.

---

## Running the App Locally

Start the app with a single command:

```
npm run dev
```

This starts both the backend and frontend together. You'll see output labelled in two colours:

- **[backend]** — the server handling data and API requests
- **[frontend]** — the website you see in your browser

Once you see the message showing the local URL, open your browser and go to:

```
http://localhost:5173
```

The app is now running on your computer! Any changes you make to frontend files will update in the browser automatically (no need to refresh).

### Stopping the App

Press `Ctrl + C` in the Terminal window to stop both servers.

### After Making Frontend Changes

If you're using the dev server (`npm run dev`), changes appear automatically in the browser — no extra steps needed.

If you need a production-like build (for testing exactly what will be deployed):

```
cd client && npm install && npm run build
```

### After Making Backend Changes

The backend auto-restarts when you save a file (thanks to `--watch` mode). No manual restart needed.

---

## Making Changes

### The Golden Rule

**Never work directly on the `master` branch.** Always create a new branch for your changes. This keeps the production app safe while you work.

### Step-by-Step

**1. Make sure you have the latest code:**

```
git checkout master
git pull
```

**2. Create a new branch for your work:**

Pick a name that describes what you're doing. Use one of these prefixes:

| Prefix | Use when... | Example |
|---|---|---|
| `feature/` | Adding something new | `feature/net-revenue-chart` |
| `fix/` | Fixing a bug | `fix/commission-save-bug` |
| `refactor/` | Reorganising existing code | `refactor/auth-middleware` |
| `docs/` | Updating documentation | `docs/setup-guide` |
| `chore/` | Config or tooling changes | `chore/update-dependencies` |

Create the branch:

```
git checkout -b feature/my-new-feature
```

(Replace `feature/my-new-feature` with your actual branch name.)

**3. Make your changes** to the code files.

**4. See what you changed:**

```
git status
```

This shows which files you've modified or created.

---

## Saving Your Work (Git)

Git saves your work in "commits" — think of them as snapshots. Each commit should be a logical chunk of work with a clear message.

### Writing Commit Messages

Good commit messages explain **what** the change does. Start with a verb:

| Verb | Use when... |
|---|---|
| `Add` | You created something new |
| `Fix` | You fixed a bug |
| `Update` | You changed something that already existed |
| `Refactor` | You reorganised code without changing behaviour |
| `Remove` | You deleted something |

**Good examples:**
```
Add gross/net revenue toggle on monthly trend chart
Fix property commission save bug (field name mismatch)
Update VAT calculation to be per-platform
```

**Bad examples:**
```
fixed stuff
updates
WIP
```

### How to Commit

**1. Stage the files you want to include:**

```
git add filename.js another-file.tsx
```

Or to add all changed files:

```
git add -A
```

**2. Create the commit:**

```
git commit -m "Add description of what you did"
```

Keep the message under 72 characters. If you need more detail, leave a blank line and add a longer explanation:

```
git commit -m "Fix commission calculation for Booking.com

The commission percentage was being applied to the net amount
instead of the gross amount, causing incorrect deductions."
```

---

## Submitting Your Changes (Pull Requests)

When your work is ready, push it to GitHub and open a **Pull Request** (PR). A PR lets others review your changes before they go live.

**1. Push your branch to GitHub:**

```
git push -u origin feature/my-new-feature
```

(Use your actual branch name.)

**2. Open a Pull Request:**

Go to the repository on GitHub — you'll see a banner suggesting you create a PR. Click it, or go to the "Pull Requests" tab and click "New pull request".

**3. Fill in the PR:**

- **Title:** Short summary (under 70 characters), e.g., `Add net revenue chart to analytics page`
- **Description:** Explain what you changed and why. Include:
  - What the change does
  - Why it was needed
  - How to test it
  - Screenshots if it's a visual change

**4. Request a review** from a team member.

**5. After approval**, merge the PR on GitHub (use the "Merge" or "Squash and merge" button).

**6. Delete your branch** after merging (GitHub offers a button for this).

---

## Code Review

When reviewing someone else's PR (or having yours reviewed), focus on:

- **Does it work?** Test it locally if possible
- **Is it clear?** Can you understand what the code does?
- **Is it safe?** Watch for:
  - User input being put directly into database queries (SQL injection)
  - Missing authentication checks on API routes
  - Hardcoded secrets or passwords
- **Are the business rules correct?** Especially revenue and commission calculations

Be kind and constructive in reviews. Suggest improvements, don't just point out problems.

---

## How the Project is Organised

```
my-rental-tool/
├── server.js                  # Starting point for the backend
├── package.json               # Backend config and dependencies
│
├── client/                    # Everything for the frontend
│   ├── package.json           # Frontend dependencies
│   ├── vite.config.ts         # Dev server configuration
│   ├── src/
│   │   ├── components/        # UI pages and elements
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── AnalyticsPage.tsx
│   │   │   ├── PropertiesPage.tsx
│   │   │   ├── CleanersPage.tsx
│   │   │   └── ...
│   │   └── data/              # Functions that fetch data from the backend
│   └── dist/                  # Built frontend files (auto-generated, don't edit)
│
├── src/                       # Everything for the backend
│   ├── routes/                # API endpoints (where the frontend sends requests)
│   │   ├── auth.js            # Login / logout
│   │   ├── properties.js      # Property management
│   │   ├── analytics.js       # Revenue and statistics
│   │   ├── cleaners.js        # Cleaner management
│   │   └── ...
│   ├── services/              # Business logic (the "brain" of the app)
│   │   ├── smoobu.js          # Talks to the Smoobu API
│   │   ├── exchange-rates.js  # Currency conversion
│   │   └── ...
│   ├── db/
│   │   ├── database.js        # Database connection
│   │   └── migrations.js      # Database structure (tables, columns)
│   ├── middleware/
│   │   └── auth.js            # Security — checks who is logged in
│   ├── auth/
│   │   └── passport-setup.js  # Login methods (Google, password, PIN)
│   └── cron/
│       └── jobs.js            # Tasks that run on a schedule
│
├── CLAUDE.md                  # Instructions for Claude Code (AI assistant)
├── CONTRIBUTING.md            # This file
└── .gitignore                 # Files that Git should ignore
```

### How a Request Flows Through the App

1. You visit a page in the browser (frontend)
2. The frontend sends a request to the backend (e.g., "give me all bookings")
3. The backend checks if you're logged in (`auth.js` middleware)
4. The backend checks which properties you're allowed to see (`scopeProperties`)
5. The backend fetches data from the database or Smoobu
6. The data is sent back to the frontend, which displays it

### User Roles

| Role | Access |
|---|---|
| `admin` | Everything — all properties, all settings |
| `property_manager` | Only their assigned properties |
| `cleaner` | Only their assigned properties (limited features) |

Cleaners can also log in via a PIN code (separate from the main login).

---

## Coding Style Guide

### Backend (the `src/` folder)

- Written in **JavaScript** (not TypeScript)
- File names use **lowercase with hyphens**: `exchange-rates.js`, `cleaner-portal.js`
- Use `require()` to import and `module.exports` to export
- Keep route files thin — put logic in the `services/` folder
- **Always** use parameterised database queries (`$1`, `$2`) — never build queries by joining strings with user input

### Frontend (the `client/src/` folder)

- Written in **TypeScript** (JavaScript with type safety)
- File names use **PascalCase**: `AnalyticsPage.tsx`, `BookingDetailSheet.tsx`
- Use **Tailwind CSS** classes for styling (no separate `.css` files)
- Charts use the **Recharts** library
- Icons use the **Lucide React** library

### General Rules

- Keep functions small — each function should do one thing
- Remove code you're not using (no commented-out blocks)
- Use clear names that describe what something does
- Currency is always shown in South African Rand with `R` prefix (e.g., `R 1,250.00`)

---

## Database Changes

The database structure (tables, columns) is defined in `src/db/migrations.js`. Migrations run automatically every time the app starts.

### Adding a New Column

Add your `ALTER TABLE` statement to `migrations.js`. Use `IF NOT EXISTS` so it's safe to run multiple times:

```sql
ALTER TABLE properties ADD COLUMN IF NOT EXISTS my_new_column TEXT DEFAULT '';
```

### Adding a New Table

Use `CREATE TABLE IF NOT EXISTS`:

```sql
CREATE TABLE IF NOT EXISTS my_new_table (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
```

### Rules

- **Never delete** columns or tables without discussing it first
- Always use `IF NOT EXISTS` / `IF NOT EXISTS` so migrations are safe to re-run
- Use parameterised queries (`$1`, `$2`) when reading/writing data — never concatenate user input into SQL strings

---

## How Deployment Works

Deployment is fully automatic:

1. You merge your PR into `master` on GitHub
2. Railway detects the change and starts building
3. It installs dependencies, builds the frontend, and starts the server
4. Database migrations run automatically on startup

That's it — no manual steps. You can monitor the deploy on the Railway dashboard.

**Important:** Since merging to `master` immediately deploys to production, always test your changes locally first and get a code review.

---

## Important Business Rules

These are rules the app enforces. Keep them in mind when making changes:

- **Smoobu is the source of truth** — booking and property data comes from Smoobu via its API. We sync it, we don't create it manually
- **Revenue calculations** are per-property, per-platform (Airbnb, Booking.com, Vrbo):
  - Each platform has its own commission rate, bank charges, and VAT percentage
  - **Net revenue** = gross revenue - commission - bank charges - VAT
  - **VAT** is calculated on (commission + bank charges), not on gross revenue
- **Currency** is always displayed in ZAR (South African Rand) with an `R` prefix

---

## Troubleshooting

### "command not found: node"
Node.js isn't installed or Terminal can't find it. Reinstall from [nodejs.org](https://nodejs.org) and restart Terminal.

### "command not found: railway"
Railway CLI isn't installed. Run `brew install railway`. If you don't have Homebrew, see the [installation section](#3-railway-cli-connects-to-our-database-and-services).

### "railway: project not linked"
You need to link the project first. Run `railway link` from inside the `my-rental-tool` folder.

### The app starts but shows errors about the database
Make sure you've run `railway link` and that you're starting the app with `npm run dev` (which uses `railway run` under the hood to connect to the database).

### Frontend changes aren't showing up
If you're running `npm run dev`, changes should appear automatically. Try a hard refresh in the browser: `Cmd + Shift + R`.

### "Port 3000 already in use"
Another process is using port 3000. Either stop it or find what's using it:
```
lsof -i :3000
```
Then stop that process, or restart Terminal.

### npm install fails
Try deleting the `node_modules` folders and reinstalling:
```
rm -rf node_modules client/node_modules
npm run setup
```
