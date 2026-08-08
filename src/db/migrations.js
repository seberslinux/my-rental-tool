const { pool, getOne } = require('./database');

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id SERIAL PRIMARY KEY,
      smoobu_id INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      cleaning_hours_required REAL DEFAULT 2.5,
      base_price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cleaners (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cleaner_properties (
      cleaner_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      PRIMARY KEY (cleaner_id, property_id),
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaner_availability (
      id SERIAL PRIMARY KEY,
      cleaner_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaner_availability_overrides (
      id SERIAL PRIMARY KEY,
      cleaner_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaning_jobs (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      cleaner_id INTEGER,
      booking_id INTEGER,
      cleaning_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'completed')),
      notified INTEGER NOT NULL DEFAULT 0,
      reminder_sent INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_dates (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      smoobu_id INTEGER UNIQUE NOT NULL,
      property_id INTEGER NOT NULL,
      guest_name TEXT DEFAULT '',
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      platform TEXT DEFAULT '',
      total_price REAL DEFAULT 0,
      status TEXT DEFAULT 'confirmed',
      num_guests INTEGER DEFAULT 1,
      created_at TEXT DEFAULT '',
      lead_time_days INTEGER DEFAULT 0,
      length_of_stay INTEGER DEFAULT 1,
      price_per_night REAL DEFAULT 0,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_rates (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      price REAL DEFAULT 0,
      min_stay INTEGER DEFAULT 1,
      available INTEGER DEFAULT 1,
      fetched_at TEXT DEFAULT NOW(),
      UNIQUE(property_id, date),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      booking_id INTEGER,
      platform TEXT DEFAULT '',
      guest_name TEXT DEFAULT '',
      rating REAL,
      comment TEXT DEFAULT '',
      review_date TEXT NOT NULL,
      response TEXT DEFAULT '',
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT DEFAULT '',
      expense_date TEXT NOT NULL,
      receipt_path TEXT DEFAULT '',
      recurring INTEGER DEFAULT 0,
      recurring_frequency TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS property_costs (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      monthly_amount REAL DEFAULT 0,
      is_variable INTEGER DEFAULT 0,
      UNIQUE(property_id, category_id),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      platform TEXT DEFAULT '',
      listing_url TEXT DEFAULT '',
      listing_id TEXT DEFAULT '',
      bedrooms INTEGER DEFAULT 0,
      location TEXT DEFAULT '',
      avg_nightly_rate REAL DEFAULT 0,
      estimated_occupancy REAL DEFAULT 0,
      review_score REAL DEFAULT 0,
      last_updated TEXT DEFAULT '',
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS csv_keyword_mappings (
      id SERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaner_payments (
      id SERIAL PRIMARY KEY,
      cleaner_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      amount REAL NOT NULL,
      paid_at TEXT,
      payment_method TEXT,
      notes TEXT,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_issues (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'General',
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      reported_date TEXT NOT NULL,
      resolved_date TEXT,
      cost REAL DEFAULT 0,
      assigned_to TEXT,
      FOREIGN KEY (property_id) REFERENCES properties(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cleaner' CHECK(role IN ('admin','property_manager','cleaner')),
      google_id TEXT UNIQUE,
      avatar_url TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_property_access (
      user_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, property_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER,
      subject TEXT DEFAULT '',
      body TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT NOW(),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (recipient_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_checklists (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      expected_quantity INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_checks (
      id SERIAL PRIMARY KEY,
      checklist_item_id INTEGER NOT NULL,
      cleaning_job_id INTEGER NOT NULL,
      actual_quantity INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok' CHECK(status IN ('ok','low','missing','damaged')),
      notes TEXT DEFAULT '',
      checked_at TEXT DEFAULT NOW(),
      FOREIGN KEY (checklist_item_id) REFERENCES inventory_checklists(id) ON DELETE CASCADE,
      FOREIGN KEY (cleaning_job_id) REFERENCES cleaning_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shopping_list (
      id SERIAL PRIMARY KEY,
      property_id INTEGER,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit TEXT DEFAULT '',
      added_by INTEGER NOT NULL,
      status TEXT DEFAULT 'needed' CHECK(status IN ('needed','purchased')),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      purchased_at TEXT,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cleaner_notification_prefs (
      id SERIAL PRIMARY KEY,
      cleaner_id INTEGER NOT NULL UNIQUE,
      whatsapp_enabled INTEGER DEFAULT 1,
      notify_7_days INTEGER DEFAULT 1,
      notify_1_day INTEGER DEFAULT 1,
      notify_2_hours INTEGER DEFAULT 1,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ical_tokens (
      id SERIAL PRIMARY KEY,
      cleaner_id INTEGER NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT NOW(),
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    -- A cleaner may put an item on the shopping list.
    --
    -- added_by is a foreign key to users, and a cleaner signing in with a
    -- PIN has no user row — so the endpoint refused them outright:
    -- "Shopping list not available for PIN-auth cleaners". The person who
    -- runs out of bin liners is precisely the person standing in the
    -- kitchen. Either column may be null; exactly one is set.
    ALTER TABLE shopping_list ALTER COLUMN added_by DROP NOT NULL;
    ALTER TABLE shopping_list ADD COLUMN IF NOT EXISTS added_by_cleaner_id INTEGER
      REFERENCES cleaners(id) ON DELETE SET NULL;

    -- When the cleaner arrived and when they finished.
    --
    -- cleaning_jobs carried a status and no times at all, so nothing
    -- recorded when a property was actually turned over or how long it
    -- took — the two facts that tell you whether the next check-in is
    -- safe and whether an hourly rate matches the work.
    ALTER TABLE cleaning_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
    ALTER TABLE cleaning_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    -- How each person wants to hear about things.
    --
    -- In-app is the baseline and cannot be switched off: the feed is the
    -- record, and a record you can opt out of is not one. WhatsApp is
    -- opt-in per person, because a channel somebody did not ask for is
    -- the fastest way to have them mute it.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_whatsapp INTEGER NOT NULL DEFAULT 0;

    -- Every notification the app decides to send, and what became of it.
    --
    -- Four call sites used to reach for whatsapp.sendMessage directly and
    -- swallow the error. That is why all fourteen cleaning jobs in
    -- production read notified = 0 while the app reported them assigned:
    -- the sends had been failing since the access token expired and
    -- nothing anywhere said so.
    --
    -- A row is written whether or not delivery is attempted, so the
    -- record of what happened does not depend on the channel working.
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      event TEXT NOT NULL,
      -- Who it is about, for filtering a feed.
      property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
      cleaner_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL,
      job_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      -- Where the message takes you. A notification that lands you on the
      -- screen where you can act beats one you have to go and find.
      link TEXT,
      -- 'info' lands in the feed only; 'attention' also goes out.
      severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','attention')),
      channel TEXT NOT NULL DEFAULT 'in_app',
      -- 'skipped' means we chose not to send, not that sending failed.
      delivery TEXT NOT NULL DEFAULT 'skipped'
        CHECK (delivery IN ('skipped','sent','failed')),
      delivery_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);

    -- Explicit, because a column added inside CREATE TABLE IF NOT EXISTS
    -- reaches only databases that did not have the table yet. Any
    -- environment created between the table landing and the column being
    -- added would silently never get it, and the failure appears far
    -- from the cause.
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

    -- One-time invitations that let a cleaner set their own PIN.
    --
    -- The owner decides who gets access; the cleaner decides how they get
    -- in. Storing a PIN the owner chose meant the owner held the
    -- cleaner's credential, and since PINs are hashed they could never be
    -- read back either, so a forgotten one could only be overwritten.
    --
    -- Separate from ical_tokens, which is a permanent per-cleaner feed
    -- key with no expiry and no single-use semantics. An invitation is
    -- the opposite of that on both counts.
    CREATE TABLE IF NOT EXISTS cleaner_invites (
      id SERIAL PRIMARY KEY,
      cleaner_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_by INTEGER,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cleaner_invites_cleaner
      ON cleaner_invites (cleaner_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id SERIAL PRIMARY KEY,
      base_currency TEXT NOT NULL DEFAULT 'EUR',
      target_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      rate_date TEXT NOT NULL,
      fetched_at TEXT DEFAULT NOW(),
      UNIQUE(base_currency, target_currency, rate_date)
    );

    -- Public holidays fetched from Nager.Date, cached per country-year.
    -- A whole year is fetched at once, so the presence of any row for a
    -- (country, year) means that year is fully cached — see
    -- services/holidays-store.js.
    CREATE TABLE IF NOT EXISTS holidays (
      id SERIAL PRIMARY KEY,
      country TEXT NOT NULL,
      year INTEGER NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'api',
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(country, date, name)
    );

    -- School holidays are ranges, not days: Germany's summer break runs
    -- weeks, and it is the window that moves long-haul bookings. The date
    -- column holds the start; end_date is null for a single-day public
    -- holiday.
    ALTER TABLE holidays ADD COLUMN IF NOT EXISTS end_date TEXT;
    -- 'public' affects local operations; 'school' signals inbound demand.
    ALTER TABLE holidays ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'public';
    -- How many states/regions observe it. German school holidays are
    -- staggered deliberately, so "16 states" is part of reading the range.
    ALTER TABLE holidays ADD COLUMN IF NOT EXISTS regions INTEGER DEFAULT 0;

    CREATE INDEX IF NOT EXISTS holidays_country_year_idx ON holidays (country, year);
  `);

  // Seed default settings
  await pool.query(`
    INSERT INTO app_settings (key, value) VALUES ('display_currency', 'ZAR')
    ON CONFLICT (key) DO NOTHING
  `);

  // Add columns to existing tables if missing (PG-compatible approach)
  const alterColumns = async (table, columns) => {
    for (const [col, type] of columns) {
      try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      } catch (e) {
        // Column already exists, ignore (PG error code 42701)
      }
    }
  };

  await alterColumns('bookings', [
    ['created_at', "TEXT DEFAULT ''"],
    ['lead_time_days', 'INTEGER DEFAULT 0'],
    ['length_of_stay', 'INTEGER DEFAULT 1'],
    ['price_per_night', 'REAL DEFAULT 0'],
    ['special_requirements', "TEXT DEFAULT ''"],
    ['commission', 'REAL DEFAULT 0'],
    ['language', "TEXT DEFAULT ''"],
    ['children', 'INTEGER DEFAULT 0'],
    // The complete Smoobu payload, verbatim. Mapped columns above exist for
    // querying; this exists so nothing is ever lost. Smoobu's API only
    // serves a limited window, so a field we did not think to map today
    // cannot be fetched again later — but it can be backfilled from here.
    ['raw_payload', 'JSONB'],
    ['guest_country', "TEXT DEFAULT ''"],
    ['currency', "TEXT DEFAULT 'ZAR'"],
    ['modified_at', "TEXT DEFAULT ''"],
  ]);

  await alterColumns('properties', [
    ['airbnb_url', "TEXT DEFAULT ''"],
    ['airbnb_id', "TEXT DEFAULT ''"],
    ['booking_url', "TEXT DEFAULT ''"],
    ['booking_id_ext', "TEXT DEFAULT ''"],
    ['vrbo_url', "TEXT DEFAULT ''"],
    ['vrbo_id', "TEXT DEFAULT ''"],
    ['commission_airbnb', 'REAL DEFAULT 18'],
    ['commission_booking', 'REAL DEFAULT 15'],
    ['commission_vrbo', 'REAL DEFAULT 8'],
    ['bank_charge_airbnb', 'REAL DEFAULT 0'],
    ['bank_charge_booking', 'REAL DEFAULT 2.1'],
    ['bank_charge_vrbo', 'REAL DEFAULT 0'],
    ['vat_rate', 'REAL DEFAULT 0'],
    ['vat_airbnb', 'REAL DEFAULT 0'],
    ['vat_booking', 'REAL DEFAULT 0'],
    ['vat_vrbo', 'REAL DEFAULT 0'],
    ['property_type', "TEXT DEFAULT 'apartment'"],
    ['bedrooms', 'INTEGER DEFAULT 1'],
    ['bathrooms', 'INTEGER DEFAULT 1'],
    ['max_guests', 'INTEGER DEFAULT 2'],
    ['location', "TEXT DEFAULT ''"],
    ['neighbourhood', "TEXT DEFAULT ''"],
    ['wifi_network', "TEXT DEFAULT ''"],
    ['wifi_password', "TEXT DEFAULT ''"],
    ['access_code', "TEXT DEFAULT ''"],
    ['checkin_instructions', "TEXT DEFAULT ''"],
    ['checkout_instructions', "TEXT DEFAULT ''"],
    ['supply_checklist', "TEXT DEFAULT ''"],
    ['emergency_contact', "TEXT DEFAULT ''"],
    ['base_currency', "TEXT DEFAULT 'ZAR'"],
    ['check_in_time', "TEXT DEFAULT '15:00'"],
    ['check_out_time', "TEXT DEFAULT '10:00'"],
  ]);

  await alterColumns('cleaners', [
    ['hourly_rate', 'REAL DEFAULT 0'],
    ['flat_rate', 'REAL DEFAULT 0'],
    ['rate_type', "TEXT DEFAULT 'hourly'"],
    ['notes', "TEXT DEFAULT ''"],
    ['pin', 'TEXT'],
  ]);

  await alterColumns('inventory_checklists', [
    ['item_type', "TEXT DEFAULT 'task'"],
  ]);

  await alterColumns('users', [
    ['phone', "TEXT DEFAULT ''"],
  ]);

  await alterColumns('expenses', [
    ['currency', "TEXT DEFAULT 'ZAR'"],
  ]);

  await alterColumns('reviews', [
    ['sentiment', "TEXT DEFAULT ''"],
    ['external_id', "TEXT DEFAULT ''"],
    ['language', "TEXT DEFAULT ''"],
  ]);

  // Multi-tenant support: encrypted API keys on users
  await alterColumns('users', [
    ['smoobu_api_key_encrypted', "TEXT DEFAULT ''"],
    ['smoobu_api_key_iv', "TEXT DEFAULT ''"],
  ]);

  // Multi-tenant support: owner tracking on properties
  await alterColumns('properties', [
    ['owner_user_id', 'INTEGER DEFAULT NULL'],
  ]);

  // Multi-tenant support: user_properties junction table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_properties (
      user_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT DEFAULT NOW(),
      PRIMARY KEY (user_id, property_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);

  // Multi-tenant support: migrate existing user_property_access rows
  await pool.query(`
    INSERT INTO user_properties (user_id, property_id, role)
    SELECT user_id, property_id, 'manager' FROM user_property_access
    ON CONFLICT (user_id, property_id) DO NOTHING
  `);

  // The cleaning_jobs status CHECK lives here and nowhere else.
  //
  // 'declined' lets a cleaner say no: without it the only way to refuse
  // was silence, and a job left at 'pending' is indistinguishable from
  // one nobody has read, so an owner never knows to reassign it.
  // 'in_progress' is set when they check in.
  //
  // Editing this in a second place does not work — it is rebuilt here on
  // every boot, so an earlier ALTER in the schema block above is simply
  // overwritten a few hundred lines later. That is exactly what happened
  // on the first attempt, and the tests caught it.
  try {
    await pool.query("ALTER TABLE cleaning_jobs DROP CONSTRAINT IF EXISTS cleaning_jobs_status_check");
    await pool.query(
      "ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_status_check " +
      "CHECK(status IN ('pending', 'confirmed', 'declined', 'in_progress', 'completed', 'ready'))"
    );
  } catch (e) { /* constraint already updated */ }

  // Unique index for review deduplication
  try {
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_external ON reviews(property_id, external_id)");
  } catch (e) { /* index already exists */ }

  // Insert default expense categories if the table is empty
  const catCount = await getOne('SELECT COUNT(*) as c FROM expense_categories');
  if (parseInt(catCount.c) === 0) {
    const cats = ['Cleaning','Electricity','Water','Supplies','Gardening','Repair & Maintenance','Improvements','Platform Fees','Insurance','Mortgage/Bond','Other'];
    for (const c of cats) {
      await pool.query('INSERT INTO expense_categories (name, is_default) VALUES ($1, 1)', [c]);
    }
  }

  // Bootstrap admin user from env vars
  if (process.env.ADMIN_EMAIL) {
    const bcrypt = require('bcrypt');
    const userCount = await getOne('SELECT COUNT(*) as c FROM users');
    if (parseInt(userCount.c) === 0) {
      const hash = process.env.ADMIN_PASSWORD
        ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
        : null;
      await pool.query(
        'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
        [process.env.ADMIN_EMAIL, hash, process.env.ADMIN_NAME || 'Admin', 'admin']
      );
      console.log(`Admin user bootstrapped: ${process.env.ADMIN_EMAIL}`);
    } else {
      const envAdmin = await getOne('SELECT id FROM users WHERE email = $1', [process.env.ADMIN_EMAIL]);
      if (!envAdmin) {
        const firstAdmin = await getOne("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
        if (firstAdmin) {
          const hash = process.env.ADMIN_PASSWORD
            ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
            : null;
          await pool.query(
            'UPDATE users SET email = $1, password_hash = $2, name = $3, updated_at = NOW() WHERE id = $4',
            [process.env.ADMIN_EMAIL, hash, process.env.ADMIN_NAME || 'Admin', firstAdmin.id]
          );
          console.log(`Admin user updated to: ${process.env.ADMIN_EMAIL}`);
        }
      }
    }
  }

  // Migrate cleaning_jobs.booking_id from bookings.id to bookings.smoobu_id
  // This allows bookings to be deleted and re-inserted without breaking the link
  try {
    await pool.query(`
      UPDATE cleaning_jobs cj
      SET booking_id = b.smoobu_id
      FROM bookings b
      WHERE cj.booking_id = b.id
        AND cj.booking_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bookings b2 WHERE b2.smoobu_id = cj.booking_id)
    `);
  } catch (e) { /* already migrated or no rows */ }

  console.log('Database migrations complete.');
}

module.exports = { runMigrations };
