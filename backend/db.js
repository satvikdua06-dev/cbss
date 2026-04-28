const initSqlJs = require("sql.js");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const DB_FILE = "./cbss.db";
let db;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      college_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      esp_topic_id TEXT UNIQUE,
      last_seen_at INTEGER,
      online INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'AVAILABLE',
      stand_id INTEGER,
      esp_topic_id TEXT UNIQUE,
      lock_state TEXT DEFAULT 'LOCKED',
      last_lat REAL,
      last_lng REAL,
      battery_level INTEGER DEFAULT 100,
      last_seen_at INTEGER,
      online INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bike_id INTEGER NOT NULL,
      stand_id INTEGER NOT NULL,
      status TEXT DEFAULT 'PENDING_OTP',
      otp_hash TEXT NOT NULL,
      otp_attempts INTEGER DEFAULT 0,
      otp_expires_at INTEGER NOT NULL,
      return_by INTEGER NOT NULL,
      picked_up_at INTEGER,
      returned_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      booking_id INTEGER,
      message TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      resolved INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bike_gps_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bike_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS stand_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stand_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS bike_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bike_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  migrate();
  await seed();
  save();
}

function migrate() {
  const migrations = [
    "ALTER TABLE stands ADD COLUMN code TEXT",
    "ALTER TABLE stands ADD COLUMN esp_topic_id TEXT",
    "ALTER TABLE stands ADD COLUMN last_seen_at INTEGER",
    "ALTER TABLE stands ADD COLUMN online INTEGER DEFAULT 0",
    "ALTER TABLE bikes ADD COLUMN esp_topic_id TEXT",
    "ALTER TABLE bikes ADD COLUMN lock_state TEXT DEFAULT 'LOCKED'",
    "ALTER TABLE bikes ADD COLUMN battery_level INTEGER DEFAULT 100",
    "ALTER TABLE bikes ADD COLUMN last_seen_at INTEGER",
    "ALTER TABLE bikes ADD COLUMN online INTEGER DEFAULT 0",
  ];

  for (const sql of migrations) {
    try {
      db.run(sql);
    } catch {}
  }
}

function save() {
  fs.writeFileSync(DB_FILE, db.export());
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  const row = queryOne("SELECT last_insert_rowid() as id");
  save();
  return { lastInsertRowid: row ? row.id : null };
}

async function seed() {
  const count = queryOne("SELECT COUNT(*) as c FROM users");
  if (count && count.c > 0) {
    backfillDeviceMetadata();
    return;
  }

  console.log("Seeding database...");
  run(
    "INSERT INTO stands (code, name, lat, lng, esp_topic_id, online) VALUES (?, ?, ?, ?, ?, 0)",
    ["STAND-001", "Main Gate Stand", 26.8505, 75.8, "1"],
  );
  run(
    "INSERT INTO stands (code, name, lat, lng, esp_topic_id, online) VALUES (?, ?, ?, ?, ?, 0)",
    ["STAND-002", "Library Stand", 26.8515, 75.801, "2"],
  );

  run(
    "INSERT INTO bikes (code, status, stand_id, esp_topic_id, lock_state, last_lat, last_lng, online) VALUES (?, 'AVAILABLE', 1, ?, 'LOCKED', ?, ?, 0)",
    ["BIKE-001", "1", 26.8505, 75.8],
  );
  run(
    "INSERT INTO bikes (code, status, stand_id, esp_topic_id, lock_state, last_lat, last_lng, online) VALUES (?, 'AVAILABLE', 1, ?, 'LOCKED', ?, ?, 0)",
    ["BIKE-002", "2", 26.8505, 75.8],
  );
  run(
    "INSERT INTO bikes (code, status, stand_id, esp_topic_id, lock_state, last_lat, last_lng, online) VALUES (?, 'AVAILABLE', 2, ?, 'LOCKED', ?, ?, 0)",
    ["BIKE-003", "3", 26.8515, 75.801],
  );
  run(
    "INSERT INTO bikes (code, status, stand_id, esp_topic_id, lock_state, last_lat, last_lng, online) VALUES (?, 'AVAILABLE', 2, ?, 'LOCKED', ?, ?, 0)",
    ["BIKE-004", "4", 26.8515, 75.801],
  );

  const adminHash = bcrypt.hashSync("admin123", 10);
  const stuHash = bcrypt.hashSync("pass123", 10);
  run(
    "INSERT INTO users (college_id,name,email,password_hash,is_admin) VALUES (?,?,?,?,1)",
    ["ADMIN001", "Admin User", "admin@college.edu", adminHash],
  );
  run(
    "INSERT INTO users (college_id,name,email,password_hash) VALUES (?,?,?,?)",
    ["STU001", "Rahul Sharma", "rahul@college.edu", stuHash],
  );
  run(
    "INSERT INTO users (college_id,name,email,password_hash) VALUES (?,?,?,?)",
    ["STU002", "Priya Singh", "priya@college.edu", stuHash],
  );

  console.log("Seed done. Admin=ADMIN001/admin123  Students=STU001,STU002/pass123");
}

function backfillDeviceMetadata() {
  const stands = query("SELECT id, code, esp_topic_id FROM stands ORDER BY id");
  for (const stand of stands) {
    const code = stand.code || `STAND-${String(stand.id).padStart(3, "0")}`;
    const topicId = stand.esp_topic_id || String(stand.id);
    run("UPDATE stands SET code=?, esp_topic_id=? WHERE id=?", [
      code,
      topicId,
      stand.id,
    ]);
  }

  const bikes = query("SELECT id, esp_topic_id, lock_state FROM bikes ORDER BY id");
  for (const bike of bikes) {
    const topicId = bike.esp_topic_id || String(bike.id);
    const lockState = bike.lock_state || "LOCKED";
    run("UPDATE bikes SET esp_topic_id=?, lock_state=? WHERE id=?", [
      topicId,
      lockState,
      bike.id,
    ]);
  }
}

module.exports = { initDb, query, queryOne, run, save };
