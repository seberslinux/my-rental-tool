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

  // Add 'ready' to cleaning_jobs status CHECK constraint (PG)
  try {
    await pool.query("ALTER TABLE cleaning_jobs DROP CONSTRAINT IF EXISTS cleaning_jobs_status_check");
    await pool.query("ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_status_check CHECK(status IN ('pending', 'confirmed', 'completed', 'ready'))");
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

  console.log('Database migrations complete.');
}

module.exports = { runMigrations };
