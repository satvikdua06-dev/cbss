const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_FILE = './cbss.db';
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
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'AVAILABLE',
      stand_id INTEGER,
      last_lat REAL,
      last_lng REAL,
      battery_level INTEGER DEFAULT 100
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
  `);

  // Migrate existing databases
  try { db.run("ALTER TABLE bikes ADD COLUMN battery_level INTEGER DEFAULT 100"); } catch {}

  await seed();
  save();
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
  const row = queryOne('SELECT last_insert_rowid() as id');
  save();
  return { lastInsertRowid: row ? row.id : null };
}

async function seed() {
  const count = queryOne('SELECT COUNT(*) as c FROM users');
  if (count && count.c > 0) return;

  console.log('Seeding database...');
  run('INSERT INTO stands (name, lat, lng) VALUES (?, ?, ?)', ['Main Gate Stand', 26.8505, 75.8000]);
  run('INSERT INTO stands (name, lat, lng) VALUES (?, ?, ?)', ['Library Stand', 26.8515, 75.8010]);
  run("INSERT INTO bikes (code, status, stand_id, last_lat, last_lng) VALUES ('BIKE-001','AVAILABLE',1,26.8505,75.8000)");
  run("INSERT INTO bikes (code, status, stand_id, last_lat, last_lng) VALUES ('BIKE-002','AVAILABLE',1,26.8505,75.8000)");
  run("INSERT INTO bikes (code, status, stand_id, last_lat, last_lng) VALUES ('BIKE-003','AVAILABLE',2,26.8515,75.8010)");
  run("INSERT INTO bikes (code, status, stand_id, last_lat, last_lng) VALUES ('BIKE-004','AVAILABLE',2,26.8515,75.8010)");

  const adminHash = bcrypt.hashSync('admin123', 10);
  const stuHash = bcrypt.hashSync('pass123', 10);
  run('INSERT INTO users (college_id,name,email,password_hash,is_admin) VALUES (?,?,?,?,1)',
    ['ADMIN001','Admin User','admin@college.edu',adminHash]);
  run('INSERT INTO users (college_id,name,email,password_hash) VALUES (?,?,?,?)',
    ['STU001','Rahul Sharma','rahul@college.edu',stuHash]);
  run('INSERT INTO users (college_id,name,email,password_hash) VALUES (?,?,?,?)',
    ['STU002','Priya Singh','priya@college.edu',stuHash]);

  console.log('Seed done. Admin=ADMIN001/admin123  Students=STU001,STU002/pass123');
}

module.exports = { initDb, query, queryOne, run, save };
