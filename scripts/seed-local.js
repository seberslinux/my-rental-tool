#!/usr/bin/env node
/**
 * Fill a local database with enough to exercise the whole app.
 *
 * Running the app locally has meant `railway run`, which points at the
 * production database. That is fine for reading and alarming for
 * everything else: tapping "Start cleaning", issuing an invitation or
 * saving a property writes real rows, and a migration applies itself to
 * production the moment the server boots.
 *
 * This seeds a throwaway Postgres instead. The data is shaped to light
 * up every screen rather than to be minimal:
 *
 *   - stays in the past, in progress and ahead, so Revenue Earned,
 *     Revenue Coming and occupancy all have something to report
 *   - all four channels including a block, since deductions differ per
 *     channel and blocks must be excluded from both revenue and cleaning
 *   - a party with children, which is what caught the guest-count bug
 *   - nightly rates, so calendar cells are not blank
 *   - cleaning jobs at every status, plus a checklist and a maintenance
 *     issue, so the cleaner portal is not empty
 *
 * Idempotent: run it as often as you like. It clears the rows it owns
 * first, so it will not pile up duplicates.
 *
 * Never point this at production. It refuses to run against a database
 * whose URL is not local.
 */

const bcrypt = require('bcrypt');
const { pool } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrations');

const OWNER_EMAIL = 'owner@local.test';
const MANAGER_EMAIL = 'manager@local.test';
const PASSWORD = 'password123';
const CLEANER_PHONE = '+27821234567';
const CLEANER_PIN = '1234';

/** YYYY-MM-DD, n days from today, in local time. */
function day(n) {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function assertNotProduction() {
  const url = process.env.DATABASE_URL || '';
  const local = /localhost|127\.0\.0\.1|host\.docker\.internal/.test(url);
  if (!local) {
    console.error('Refusing to seed: DATABASE_URL does not look local.');
    console.error(`  DATABASE_URL=${url.replace(/:[^:@/]*@/, ':***@') || '(unset)'}`);
    console.error('  Expected something on localhost — see npm run local:db.');
    process.exit(1);
  }
}

async function seedUsers() {
  const rows = {};
  for (const [email, name, role] of [
    [OWNER_EMAIL, 'Local Owner', 'admin'],
    [MANAGER_EMAIL, 'Local Manager', 'property_manager'],
  ]) {
    const r = await pool.query(
      `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING id`,
      [email, name, role, bcrypt.hashSync(PASSWORD, 4)]
    );
    rows[role] = r.rows[0].id;
  }
  return rows;
}

async function seedProperties(ownerId) {
  const specs = [
    {
      smoobu: 900001, name: 'Hill Top Lodge', address: '12 Ocean View, Cape Town',
      // Airbnb commission left at 0 on purpose: this property exercises the
      // fallback to Smoobu's own commission figure, with VAT charged on it.
      commission_airbnb: 0, vat_rate: 15, base_price: 1600, max_guests: 6, bedrooms: 3,
    },
    {
      smoobu: 900002, name: 'The loft', address: '8 Long Street, Cape Town',
      // 18% configured, matching the real property — the other deduction path.
      commission_airbnb: 18, vat_rate: 0, base_price: 80, max_guests: 2, bedrooms: 1,
    },
  ];

  const ids = [];
  for (const s of specs) {
    const r = await pool.query(
      `INSERT INTO properties
         (smoobu_id, name, address, owner_user_id, base_currency, base_price,
          commission_airbnb, commission_booking, vat_rate, max_guests, bedrooms,
          cleaning_hours_required, check_in_time, check_out_time)
       VALUES ($1,$2,$3,$4,'ZAR',$5,$6,15,$7,$8,$9,2.5,'15:00','10:00')
       ON CONFLICT (smoobu_id) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address,
         owner_user_id = EXCLUDED.owner_user_id,
         commission_airbnb = EXCLUDED.commission_airbnb,
         vat_rate = EXCLUDED.vat_rate
       RETURNING id`,
      [s.smoobu, s.name, s.address, ownerId, s.base_price,
       s.commission_airbnb, s.vat_rate, s.max_guests, s.bedrooms]
    );
    ids.push(r.rows[0].id);
  }
  return ids;
}

async function seedBookings([hilltop, loft]) {
  await pool.query('DELETE FROM bookings WHERE smoobu_id >= 990000');

  const rows = [
    // Past — these are what Revenue Earned reports on.
    { id: 990001, p: hilltop, guest: 'Thabo Nkosi', from: -24, to: -20,
      platform: 'Airbnb', price: 9800, commission: 1740, adults: 2, children: 0, country: 'ZA' },
    { id: 990002, p: loft, guest: 'Anja Weber', from: -18, to: -15,
      platform: 'Booking.com', price: 8100, commission: 1215, adults: 2, children: 0, country: 'DE' },
    { id: 990003, p: hilltop, guest: 'Jack Spence', from: -12, to: -8,
      platform: 'Direct booking', price: 11200, commission: 0, adults: 4, children: 0, country: 'GB' },

    // A block: no guest, no money, and no clean at the end of it.
    { id: 990004, p: hilltop, guest: '', from: -7, to: -5,
      platform: 'Blocked channel auto', price: 0, commission: 0, adults: null, children: 0, country: null },

    // In progress right now — split across earned and coming.
    { id: 990005, p: loft, guest: 'Gracey Musgrave', from: -1, to: 2,
      platform: 'Airbnb', price: 9000, commission: 1620, adults: 2, children: 0, country: 'US' },

    // Arriving today, with children — the case that read as "2 guests".
    { id: 990006, p: hilltop, guest: 'Siba Daki', from: 0, to: 3,
      platform: 'Booking.com', price: 7700, commission: 1155, adults: 2, children: 2, country: 'ZA' },

    // Ahead — Revenue Coming, and forward occupancy.
    { id: 990007, p: loft, guest: 'Ntombi Nhlapo', from: 6, to: 9,
      platform: 'Airbnb', price: 6100, commission: 1098, adults: 2, children: 0, country: 'ZA' },
    { id: 990008, p: hilltop, guest: 'Mikhail Ruziakov', from: 14, to: 17,
      platform: 'Booking.com', price: 8400, commission: 1260, adults: 3, children: 1, country: 'DE' },
    { id: 990009, p: loft, guest: 'Sarah Lombard', from: 30, to: 35,
      platform: 'Direct booking', price: 14000, commission: 0, adults: 2, children: 0, country: 'ZA' },
  ];

  for (const b of rows) {
    const nights = b.to - b.from;
    await pool.query(
      `INSERT INTO bookings
         (smoobu_id, property_id, guest_name, check_in, check_out, platform,
          total_price, status, num_guests, children, commission, currency,
          length_of_stay, price_per_night, guest_country, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,'ZAR',$11,$12,$13,$14)`,
      [b.id, b.p, b.guest, day(b.from), day(b.to), b.platform, b.price,
       b.adults, b.children, b.commission, nights,
       nights > 0 ? Math.round(b.price / nights) : 0, b.country, day(b.from - 30)]
    );
  }
  return rows.length;
}

async function seedRates([hilltop, loft]) {
  await pool.query('DELETE FROM daily_rates');
  for (let i = -31; i <= 120; i++) {
    const date = day(i);
    const dow = new Date(date + 'T00:00:00').getDay();
    const weekend = dow === 0 || dow === 6;
    for (const [id, base] of [[hilltop, 2400], [loft, 2900]]) {
      await pool.query(
        `INSERT INTO daily_rates (property_id, date, price, min_stay, available)
         VALUES ($1,$2,$3,2,$4)
         ON CONFLICT (property_id, date) DO UPDATE SET price = EXCLUDED.price`,
        // A couple of closed days so the struck-through state is visible.
        [id, date, weekend ? Math.round(base * 1.3) : base, i === 20 || i === 21 ? 0 : 1]
      );
    }
  }
}

async function seedCleaners([hilltop, loft]) {
  await pool.query('DELETE FROM cleaners WHERE phone IN ($1, $2)', [CLEANER_PHONE, '+27835550000']);

  // Any job left pointing at nobody from an earlier run.
  await pool.query('DELETE FROM cleaning_jobs WHERE cleaner_id IS NULL');

  const jane = (await pool.query(
    `INSERT INTO cleaners (name, phone, email, pin, rate_type, hourly_rate, notes)
     VALUES ('Jane', $1, '', $2, 'hourly', 150, 'Has own transport') RETURNING id`,
    [CLEANER_PHONE, bcrypt.hashSync(CLEANER_PIN, 4)]
  )).rows[0].id;

  // A second cleaner with no PIN — the state where login is impossible and
  // the owner has to send an invitation.
  const sam = (await pool.query(
    `INSERT INTO cleaners (name, phone, email, rate_type, flat_rate)
     VALUES ('Sam', '+27835550000', '', 'flat', 450) RETURNING id`
  )).rows[0].id;

  for (const pid of [hilltop, loft]) {
    await pool.query(
      'INSERT INTO cleaner_properties (cleaner_id, property_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [jane, pid]
    );
  }
  await pool.query(
    'INSERT INTO cleaner_properties (cleaner_id, property_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [sam, loft]
  );

  for (const dow of [1, 2, 3, 4, 5]) {
    await pool.query(
      `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
       VALUES ($1,$2,'09:00','17:00')`,
      [jane, dow]
    );
  }

  // Clear by property, not by cleaner.
  //
  // cleaning_jobs.cleaner_id is ON DELETE SET NULL, so removing the old
  // Jane above orphans her jobs rather than deleting them — a second run
  // left every job duplicated, one copy unassigned. Owning the rows by
  // property is what makes this script safe to run twice.
  await pool.query('DELETE FROM cleaning_jobs WHERE property_id = ANY($1)', [[hilltop, loft]]);

  // Every status the portal renders, so nothing is only reachable by
  // clicking your way into it.
  const jobs = [
    [hilltop, -20, 'completed'],
    [loft, -15, 'completed'],
    [loft, 2, 'confirmed'],
    [hilltop, 3, 'pending'],
    [loft, 9, 'pending'],
    [hilltop, 17, 'confirmed'],
  ];
  for (const [pid, offset, status] of jobs) {
    await pool.query(
      `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
       VALUES ($1,$2,$3,'10:00','12:30',$4)`,
      [pid, jane, day(offset), status]
    );
  }

  await pool.query('DELETE FROM inventory_checklists');
  for (const [pid, name, cat, qty] of [
    [hilltop, 'Bath towels', 'Linen', 6],
    [hilltop, 'Bed linen sets', 'Linen', 3],
    [hilltop, 'Coffee pods', 'Kitchen', 10],
    [hilltop, 'Bin liners', 'Cleaning', 20],
    [loft, 'Bath towels', 'Linen', 2],
    [loft, 'Dishwasher tablets', 'Kitchen', 12],
  ]) {
    await pool.query(
      `INSERT INTO inventory_checklists (property_id, item_name, category, expected_quantity)
       VALUES ($1,$2,$3,$4)`,
      [pid, name, cat, qty]
    );
  }

  await pool.query('DELETE FROM maintenance_issues');
  await pool.query(
    `INSERT INTO maintenance_issues (property_id, title, description, category, priority, reported_date, assigned_to)
     VALUES ($1, 'Shower head dripping', 'Steady drip, worse in the morning', 'Plumbing', 'medium', $2, 'Jane')`,
    [hilltop, day(-3)]
  );

  return { jane, sam };
}

(async () => {
  assertNotProduction();
  await runMigrations();

  const users = await seedUsers();
  const properties = await seedProperties(users.admin);
  const bookings = await seedBookings(properties);
  await seedRates(properties);
  await seedCleaners(properties);

  console.log('');
  console.log(`Seeded ${properties.length} properties, ${bookings} bookings, 2 cleaners, 6 cleaning jobs.`);
  console.log('');
  console.log('  Owner    ' + OWNER_EMAIL + '   / ' + PASSWORD);
  console.log('  Manager  ' + MANAGER_EMAIL + ' / ' + PASSWORD);
  console.log('  Cleaner  Phone tab: 082 123 4567 / PIN ' + CLEANER_PIN);
  console.log('');
  console.log('  Sam has no PIN — use Cleaners > Invite to test that flow.');
  console.log('');

  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
