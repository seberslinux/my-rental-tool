const { getDb } = require('./database');

function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      smoobu_id INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      cleaning_hours_required REAL DEFAULT 2.5,
      base_price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cleaners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cleaner_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaner_availability_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cleaner_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaning_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      price REAL DEFAULT 0,
      min_stay INTEGER DEFAULT 1,
      available INTEGER DEFAULT 1,
      fetched_at TEXT DEFAULT (datetime('now')),
      UNIQUE(property_id, date),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT DEFAULT '',
      expense_date TEXT NOT NULL,
      receipt_path TEXT DEFAULT '',
      recurring INTEGER DEFAULT 0,
      recurring_frequency TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS property_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      monthly_amount REAL DEFAULT 0,
      is_variable INTEGER DEFAULT 0,
      UNIQUE(property_id, category_id),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cleaner_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cleaner_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      amount REAL NOT NULL,
      paid_at TEXT,
      payment_method TEXT,
      notes TEXT,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cleaner' CHECK(role IN ('admin','property_manager','cleaner')),
      google_id TEXT UNIQUE,
      avatar_url TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_property_access (
      user_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, property_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER,
      subject TEXT DEFAULT '',
      body TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (recipient_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      expected_quantity INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_item_id INTEGER NOT NULL,
      cleaning_job_id INTEGER NOT NULL,
      actual_quantity INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok' CHECK(status IN ('ok','low','missing','damaged')),
      notes TEXT DEFAULT '',
      checked_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (checklist_item_id) REFERENCES inventory_checklists(id) ON DELETE CASCADE,
      FOREIGN KEY (cleaning_job_id) REFERENCES cleaning_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shopping_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit TEXT DEFAULT '',
      added_by INTEGER NOT NULL,
      status TEXT DEFAULT 'needed' CHECK(status IN ('needed','purchased')),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      purchased_at TEXT,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cleaner_notification_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cleaner_id INTEGER NOT NULL UNIQUE,
      whatsapp_enabled INTEGER DEFAULT 1,
      notify_7_days INTEGER DEFAULT 1,
      notify_1_day INTEGER DEFAULT 1,
      notify_2_hours INTEGER DEFAULT 1,
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ical_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cleaner_id INTEGER NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_currency TEXT NOT NULL DEFAULT 'EUR',
      target_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      rate_date TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      UNIQUE(base_currency, target_currency, rate_date)
    );
  `);

  // Seed default settings
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('display_currency', 'ZAR')").run();

  // Add columns to existing bookings table if missing
  const alterColumns = [
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
  ];
  for (const [col, type] of alterColumns) {
    try {
      db.exec(`ALTER TABLE bookings ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Add columns to existing properties table if missing
  const propertyColumns = [
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
  ];
  for (const [col, type] of propertyColumns) {
    try {
      db.exec(`ALTER TABLE properties ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Add columns to existing cleaners table if missing
  const cleanerColumns = [
    ['hourly_rate', 'REAL DEFAULT 0'],
    ['flat_rate', 'REAL DEFAULT 0'],
    ['rate_type', "TEXT DEFAULT 'hourly'"],
    ['notes', "TEXT DEFAULT ''"],
  ];
  for (const [col, type] of cleanerColumns) {
    try {
      db.exec(`ALTER TABLE cleaners ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Add columns to existing expenses table if missing
  const expenseColumns = [
    ['currency', "TEXT DEFAULT 'ZAR'"],
  ];
  for (const [col, type] of expenseColumns) {
    try {
      db.exec(`ALTER TABLE expenses ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Add columns to existing reviews table if missing
  const reviewColumns = [
    ['sentiment', "TEXT DEFAULT ''"],
  ];
  for (const [col, type] of reviewColumns) {
    try {
      db.exec(`ALTER TABLE reviews ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Insert default expense categories if the table is empty
  const catCount = db.prepare('SELECT COUNT(*) as c FROM expense_categories').get();
  if (catCount.c === 0) {
    const cats = ['Cleaning','Electricity','Water','Supplies','Gardening','Repair & Maintenance','Improvements','Platform Fees','Insurance','Mortgage/Bond','Other'];
    const ins = db.prepare('INSERT INTO expense_categories (name, is_default) VALUES (?, 1)');
    for (const c of cats) ins.run(c);
  }

  // Bootstrap admin user from env vars
  if (process.env.ADMIN_EMAIL) {
    const bcrypt = require('bcrypt');
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
    if (userCount.c === 0) {
      const hash = process.env.ADMIN_PASSWORD
        ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
        : null;
      db.prepare(
        'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
      ).run(process.env.ADMIN_EMAIL, hash, process.env.ADMIN_NAME || 'Admin', 'admin');
      console.log(`Admin user bootstrapped: ${process.env.ADMIN_EMAIL}`);
    } else {
      // Ensure env admin exists — update first admin if email changed
      const envAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(process.env.ADMIN_EMAIL);
      if (!envAdmin) {
        const firstAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
        if (firstAdmin) {
          const hash = process.env.ADMIN_PASSWORD
            ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
            : null;
          db.prepare('UPDATE users SET email = ?, password_hash = ?, name = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(process.env.ADMIN_EMAIL, hash, process.env.ADMIN_NAME || 'Admin', firstAdmin.id);
          console.log(`Admin user updated to: ${process.env.ADMIN_EMAIL}`);
        }
      }
    }
  }

  console.log('Database migrations complete.');
}

module.exports = { runMigrations };
