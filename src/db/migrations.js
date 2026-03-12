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
  `);

  // Add columns to existing bookings table if missing
  const alterColumns = [
    ['created_at', "TEXT DEFAULT ''"],
    ['lead_time_days', 'INTEGER DEFAULT 0'],
    ['length_of_stay', 'INTEGER DEFAULT 1'],
    ['price_per_night', 'REAL DEFAULT 0'],
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
    ['commission_airbnb', 'REAL DEFAULT 3'],
    ['commission_booking', 'REAL DEFAULT 15'],
    ['commission_vrbo', 'REAL DEFAULT 8'],
    ['property_type', "TEXT DEFAULT 'apartment'"],
    ['bedrooms', 'INTEGER DEFAULT 1'],
    ['bathrooms', 'INTEGER DEFAULT 1'],
    ['max_guests', 'INTEGER DEFAULT 2'],
    ['location', "TEXT DEFAULT ''"],
    ['neighbourhood', "TEXT DEFAULT ''"],
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

  console.log('Database migrations complete.');
}

module.exports = { runMigrations };
