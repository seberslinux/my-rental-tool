# My Rental Tool

A web app for managing short-term rental properties, built for hosts who use **Smoobu** to manage bookings across platforms like Airbnb, Booking.com, and Vrbo.

## What It Does

My Rental Tool brings together everything you need to run your rental business in one place:

- **Bookings Dashboard** — See all your bookings across properties in a calendar view, synced automatically from Smoobu
- **Revenue Analytics** — Track gross and net revenue per property, per platform, with commission, bank charges, and VAT broken down
- **Cleaner Management** — Assign cleaners to properties, manage availability schedules, and auto-assign cleaning jobs based on checkouts
- **Cleaner Portal** — Cleaners get their own PIN-based login to see their upcoming jobs
- **Dynamic Pricing** — Automated pricing engine that adjusts rates based on demand
- **Guest Messaging** — Automated check-in instructions and checkout reminders via WhatsApp
- **Maintenance Tracking** — Log and track maintenance issues per property
- **Inventory Management** — Track supplies and consumables across properties
- **Multi-User Access** — Role-based access (admin, property manager, cleaner) so each user only sees what's relevant to them

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL |
| Hosting | Railway (auto-deploys on merge) |
| Booking Data | Smoobu API + webhooks |
| Messaging | WhatsApp Business API |
| Charts | Recharts |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/seberslinux/my-rental-tool.git
cd my-rental-tool

# Install everything
npm run setup

# Start the app (runs frontend + backend together)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> You'll need access to the Railway project for database connectivity. See the [Contributing Guide](CONTRIBUTING.md) for full setup instructions.

## Automated Features

The app runs scheduled tasks in the background:

| Time (SAST) | Task |
|---|---|
| 05:00 | Auto-assign cleaners for upcoming checkouts |
| 06:00 | Dynamic pricing engine runs |
| 07:00 | Checkout reminders sent to guests |
| 10:00 | Check-in instructions sent to tomorrow's guests |
| Every 30 min | Cleaning job reminders (2 hours before start) |

## API Endpoints

All endpoints under `/api` require authentication. Public endpoints:

- `POST /webhook` — Smoobu webhook for real-time booking updates
- `GET /ical/:id` — iCal feed per property

Key authenticated endpoints:

| Endpoint | Description |
|---|---|
| `POST /api/sync/properties` | Sync properties from Smoobu |
| `POST /api/sync/bookings` | Sync bookings + auto-assign cleaners |
| `GET /api/bookings` | List bookings (filtered by user access) |
| `GET /api/dashboard/stats` | Dashboard stats (occupancy, gaps, upcoming jobs) |
| `GET/PUT /api/properties/:id` | Property settings and commission config |
| `GET/POST /api/cleaners` | Cleaner management |
| `GET /api/analytics/*` | Revenue and financial analytics |
| `POST /api/pricing/run` | Manually trigger the pricing engine |

## Contributing

We welcome contributions! Whether you're fixing a bug, adding a feature, or improving documentation, check out our **[Contributing Guide](CONTRIBUTING.md)** for everything you need to get started — including step-by-step setup instructions, coding style, Git workflow, and how to submit a pull request.

The contributing guide is written to be accessible to everyone, even if you're new to coding.

## License

ISC
