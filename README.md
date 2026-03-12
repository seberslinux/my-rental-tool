# Short-Term Rental Management Tool

A Node.js tool for managing short-term rental properties synced through Smoobu (Airbnb + Booking.com), with automated cleaner assignment, WhatsApp notifications, dynamic pricing, and guest messaging.

## Setup

```bash
npm install
cp .env.example .env
# Fill in your .env values (see below)
npm start
```

Open http://localhost:3000 in your browser.

## .env Configuration

| Variable | Description |
|---|---|
| `SMOOBU_API_KEY` | Your Smoobu API key (Settings > API in Smoobu) |
| `WHATSAPP_TOKEN` | Meta WhatsApp Business Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Your WhatsApp Business Account ID |
| `CHECKIN_MESSAGE_TEMPLATE` | Guest check-in message (supports `{guest_name}`, `{property_name}`, `{check_in}`) |
| `CHECKOUT_MESSAGE_TEMPLATE` | Guest checkout reminder message |
| `PORT` | Server port (default: 3000) |

## Usage

1. **Sync Properties** — Click "Sync Properties" on the dashboard to pull apartments from Smoobu
2. **Configure Properties** — Go to Properties page to set address, cleaning hours, and base price
3. **Add Cleaners** — Go to Cleaners page to add cleaners with WhatsApp numbers, assign to properties, and set availability
4. **Sync Bookings** — Click "Sync Bookings" to pull reservations and auto-assign cleaners
5. **Webhook** — Configure `POST https://yourdomain.com/webhook` in Smoobu for real-time booking updates

## Automated Features (Cron)

- **06:00 SAST** — Dynamic pricing engine runs
- **07:00 SAST** — Checkout reminders sent to guests
- **10:00 SAST** — Check-in instructions sent to tomorrow's guests
- **05:00 SAST** — Cleaner assignment for upcoming checkouts
- **Every 30 min** — Cleaning job reminders (2 hours before start)

## API Endpoints

- `POST /api/sync/properties` — Sync properties from Smoobu
- `POST /api/sync/bookings` — Sync bookings + run cleaner assignment
- `GET /api/bookings` — List all bookings
- `GET /api/dashboard/stats` — Dashboard stats (occupancy, gaps, checkouts, jobs)
- `GET/PUT /api/properties/:id` — Property settings
- `GET/POST /api/cleaners` — Cleaner management
- `PUT/DELETE /api/cleaners/:id` — Edit/delete cleaner
- `POST /api/cleaners/:id/properties` — Assign property
- `PUT /api/cleaners/:id/availability` — Set weekly schedule
- `POST /api/cleaners/:id/overrides` — Date overrides
- `POST /api/pricing/run` — Manually run pricing engine
- `POST /webhook` — Smoobu webhook endpoint
