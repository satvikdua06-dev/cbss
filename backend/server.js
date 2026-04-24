const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const mqtt = require("mqtt");
const { initDb, query, queryOne, run } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const JWT_SECRET = "cbss-secret-key";
const INTERNAL_API_KEY = "cbss-internal-key-123";
const MQTT_BROKER = "mqtt://broker.hivemq.com";

// Campus boundary polygon [lat, lng] — bikes outside this trigger geofence alert
const CAMPUS_POLYGON = [
  [26.8495, 75.7990],
  [26.8530, 75.7990],
  [26.8530, 75.8025],
  [26.8495, 75.8025],
];

// ── MQTT ──────────────────────────────────────────────────────────────────────

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: "cbss-server-" + Math.random().toString(16).slice(2, 10),
});

mqttClient.on("connect", () => {
  mqttClient.subscribe("cbss/bike/+/gps");
  mqttClient.subscribe("cbss/stand/+/otp");
  console.log("[MQTT] Connected — subscribed to bike GPS + stand OTP topics");
});

mqttClient.on("message", (topic, message) => {
  try {
    const parts = topic.split("/");
    const data  = JSON.parse(message.toString());
    if (parts[1] === "bike" && parts[3] === "gps") {
      const bikeId = parseInt(parts[2], 10);
      if (!isNaN(bikeId)) handleGpsPing(bikeId, data.lat, data.lng, data.battery);
    } else if (parts[1] === "stand" && parts[3] === "otp") {
      const standId = parseInt(parts[2], 10);
      if (!isNaN(standId)) handleStandOtp(standId, data.otp);
    }
  } catch (e) {
    console.error("[MQTT] Bad message on", topic, e.message);
  }
});

mqttClient.on("error", (err) => console.error("[MQTT] Error:", err.message));

function publishLockCommand(bikeId) {
  mqttClient.publish(
    `cbss/bike/${bikeId}/command`,
    JSON.stringify({ command: "lock" }),
  );
  console.log(`[MQTT] Lock command → bike #${bikeId}`);
}

function publishStandResult(standId, result, message) {
  mqttClient.publish(
    `cbss/stand/${standId}/result`,
    JSON.stringify({ result, message }),
  );
}

// Called when an ESP32 keypad sends an OTP for a given stand over MQTT
function handleStandOtp(standId, otp) {
  if (!otp || otp.length !== 6) {
    publishStandResult(standId, "ERROR", "OTP must be 6 digits.");
    return;
  }

  // Find every PENDING_OTP booking whose bike is docked at this stand
  const bookings = query(
    `SELECT b.* FROM bookings b
     JOIN bikes bk ON b.bike_id = bk.id
     WHERE bk.stand_id = ? AND b.status = 'PENDING_OTP'`,
    [standId],
  );

  if (!bookings.length) {
    publishStandResult(standId, "NO_BOOKING", "No pending booking at this stand.");
    console.log(`[STAND ${standId}] OTP received but no pending booking`);
    return;
  }

  const t = now();
  let matched = false;

  for (const booking of bookings) {
    // Expire stale bookings
    if (t > booking.otp_expires_at) {
      run("UPDATE bookings SET status='EXPIRED' WHERE id=?", [booking.id]);
      run("UPDATE bikes SET status='AVAILABLE' WHERE id=?", [booking.bike_id]);
      continue;
    }

    if (bcrypt.compareSync(otp, booking.otp_hash)) {
      run("UPDATE bookings SET status='ACTIVE',picked_up_at=?,otp_hash='' WHERE id=?", [t, booking.id]);
      run("UPDATE bikes SET status='IN_USE' WHERE id=?", [booking.bike_id]);
      publishStandResult(standId, "UNLOCKED", "Bike unlocked!");
      console.log(`[STAND ${standId}] Bike #${booking.bike_id} unlocked via keypad ✓`);
      matched = true;
      break;
    }

    // Wrong OTP — increment attempts
    const attempts = booking.otp_attempts + 1;
    run("UPDATE bookings SET otp_attempts=? WHERE id=?", [attempts, booking.id]);

    if (attempts >= 3) {
      run("UPDATE bookings SET status='FLAGGED' WHERE id=?", [booking.id]);
      run("UPDATE bikes SET status='AVAILABLE' WHERE id=?", [booking.bike_id]);
      run("INSERT INTO alerts (type,booking_id,message) VALUES ('OTP_BRUTE_FORCE',?,?)", [
        booking.id,
        `3 failed OTP attempts at stand #${standId}. Possible unauthorized access.`,
      ]);
      publishStandResult(standId, "LOCKED", "Too many wrong attempts. Guard alerted.");
      matched = true;
      break;
    }

    publishStandResult(standId, "WRONG", `Wrong OTP. ${3 - attempts} attempt(s) remaining.`);
    matched = true;
    break;
  }

  if (!matched) {
    publishStandResult(standId, "EXPIRED", "OTP expired. Please make a new booking.");
  }
}
// ── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000,
    toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1),
    dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isAtStand(bike) {
  const stands = query("SELECT * FROM stands");
  return (
    stands.find(
      (s) => haversineMeters(bike.last_lat, bike.last_lng, s.lat, s.lng) < 30,
    ) || null
  );
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ilat, ilng] = polygon[i];
    const [jlat, jlng] = polygon[j];
    if (
      (ilng > lng) !== (jlng > lng) &&
      lat < ((jlat - ilat) * (lng - ilng)) / (jlng - ilng) + ilat
    )
      inside = !inside;
  }
  return inside;
}

function handleGpsPing(bikeId, lat, lng, battery) {
  const bike = queryOne("SELECT * FROM bikes WHERE id=?", [bikeId]);
  if (!bike) return;

  // 1. Persist location + battery
  if (battery != null) {
    run("UPDATE bikes SET last_lat=?,last_lng=?,battery_level=? WHERE id=?", [
      lat, lng, battery, bikeId,
    ]);
    // Alert once when crossing below 20 %
    if (battery < 20 && (bike.battery_level == null || bike.battery_level >= 20)) {
      run("INSERT INTO alerts (type,message) VALUES ('LOW_BATTERY',?)", [
        `Bike ${bike.code} battery at ${battery}%. Needs charging.`,
      ]);
      console.log(`[ALERT] Low battery — ${bike.code}: ${battery}%`);
    }
  } else {
    run("UPDATE bikes SET last_lat=?,last_lng=? WHERE id=?", [lat, lng, bikeId]);
  }

  // 2. Log GPS history for active booking
  const booking = queryOne(
    "SELECT id FROM bookings WHERE bike_id=? AND status='ACTIVE'",
    [bikeId],
  );
  if (booking) {
    run(
      "INSERT INTO bike_gps_history (bike_id,booking_id,lat,lng) VALUES (?,?,?,?)",
      [bikeId, booking.id, lat, lng],
    );
  }

  // 3. Tamper detection — parked bike moved > 20 m from its stand
  if (bike.status === "AVAILABLE" && bike.stand_id) {
    const stand = queryOne("SELECT * FROM stands WHERE id=?", [bike.stand_id]);
    if (stand) {
      const dist = haversineMeters(lat, lng, stand.lat, stand.lng);
      if (dist > 20) {
        const existing = queryOne(
          "SELECT id FROM alerts WHERE type='TAMPER' AND resolved=0 AND message LIKE ?",
          [`%${bike.code}%`],
        );
        if (!existing) {
          run("INSERT INTO alerts (type,message) VALUES ('TAMPER',?)", [
            `Tamper detected: ${bike.code} moved ${Math.round(dist)}m from ${stand.name} without a booking.`,
          ]);
          console.log(`[ALERT] Tamper — ${bike.code} is ${Math.round(dist)}m from stand`);
        }
      }
    }
  }

  // 4. Geofence — active booking outside campus polygon
  if (bike.status === "IN_USE" && booking) {
    if (!pointInPolygon(lat, lng, CAMPUS_POLYGON)) {
      const existing = queryOne(
        "SELECT id FROM alerts WHERE type='OUT_OF_BOUNDS' AND booking_id=?",
        [booking.id],
      );
      if (!existing) {
        run(
          "INSERT INTO alerts (type,booking_id,message) VALUES ('OUT_OF_BOUNDS',?,?)",
          [
            booking.id,
            `Bike ${bike.code} left the campus boundary. GPS: (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
          ],
        );
        run("UPDATE bookings SET status='FLAGGED' WHERE id=?", [booking.id]);
        run("UPDATE bikes SET status='MISSING' WHERE id=?", [bikeId]);
        console.log(`[ALERT] Geofence breach — ${bike.code} at (${lat.toFixed(5)},${lng.toFixed(5)})`);
      }
    }
  }
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function now() {
  return Math.floor(Date.now() / 1000);
}

// ── Middleware ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(header.replace("Bearer ", ""), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin)
      return res.status(403).json({ error: "Admin only" });
    next();
  });
}

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== INTERNAL_API_KEY)
    return res.status(401).json({ error: "Invalid API key" });
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post("/register", async (req, res) => {
  const { collegeId, name, email, password } = req.body;
  if (!collegeId || !name || !email || !password)
    return res.status(400).json({ error: "All fields required" });

  if (
    queryOne("SELECT id FROM users WHERE college_id=? OR email=?", [
      collegeId,
      email,
    ])
  )
    return res
      .status(409)
      .json({ error: "College ID or email already registered" });

  const hash = bcrypt.hashSync(password, 10);
  const result = run(
    "INSERT INTO users (college_id,name,email,password_hash) VALUES (?,?,?,?)",
    [collegeId, name, email, hash],
  );
  res.json({ message: "Registered", userId: result.lastInsertRowid });
});

app.post("/login", (req, res) => {
  const { collegeId, password } = req.body;
  const user = queryOne("SELECT * FROM users WHERE college_id=?", [collegeId]);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Invalid credentials" });
  if (user.is_banned)
    return res.status(403).json({ error: "Your account has been banned" });

  const token = jwt.sign(
    {
      id: user.id,
      name: user.name,
      college_id: user.college_id,
      is_admin: user.is_admin,
    },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
  res.json({ token, name: user.name, is_admin: user.is_admin });
});

app.get("/me", requireAuth, (req, res) => {
  const user = queryOne(
    "SELECT id,college_id,name,email,is_admin,is_banned FROM users WHERE id=?",
    [req.user.id],
  );
  res.json(user);
});

// ── Stands & Bikes ────────────────────────────────────────────────────────────

app.get("/stands", (req, res) => {
  const stands = query("SELECT * FROM stands");
  const result = stands.map((s) => ({
    ...s,
    available_bikes: queryOne(
      "SELECT COUNT(*) as c FROM bikes WHERE stand_id=? AND status='AVAILABLE'",
      [s.id],
    ).c,
  }));
  res.json(result);
});

app.get("/stands/:id/bikes", (req, res) => {
  res.json(
    query("SELECT * FROM bikes WHERE stand_id=? AND status='AVAILABLE'", [
      req.params.id,
    ]),
  );
});

// ── Bookings ──────────────────────────────────────────────────────────────────

app.post("/bookings", requireAuth, (req, res) => {
  const { bikeId, returnMinutes } = req.body;
  if (![15, 30, 60].includes(Number(returnMinutes)))
    return res
      .status(400)
      .json({ error: "returnMinutes must be 15, 30, or 60" });

  const user = queryOne("SELECT * FROM users WHERE id=?", [req.user.id]);
  if (user.is_banned) return res.status(403).json({ error: "You are banned" });

  if (
    queryOne(
      "SELECT id FROM bookings WHERE user_id=? AND status IN ('PENDING_OTP','ACTIVE')",
      [req.user.id],
    )
  )
    return res
      .status(409)
      .json({ error: "You already have an active booking" });

  const bike = queryOne("SELECT * FROM bikes WHERE id=?", [bikeId]);
  if (!bike || bike.status !== "AVAILABLE")
    return res.status(400).json({ error: "Bike not available" });

  const otp = generateOTP();
  const otp_hash = bcrypt.hashSync(otp, 10);
  const t = now();

  const result = run(
    `INSERT INTO bookings (user_id,bike_id,stand_id,status,otp_hash,otp_expires_at,return_by)
     VALUES (?,?,?,'PENDING_OTP',?,?,?)`,
    [
      req.user.id,
      bikeId,
      bike.stand_id,
      otp_hash,
      t + 600,
      t + returnMinutes * 60,
    ],
  );

  run("UPDATE bikes SET status='BOOKED' WHERE id=?", [bikeId]);
  console.log(
    `[OTP] Booking #${result.lastInsertRowid} for ${user.name} — OTP: ${otp}`,
  );
  res.json({
    bookingId: result.lastInsertRowid,
    otp,
    bikeCode: bike.code,
    returnMinutes,
  });
});

app.get("/bookings/mine", requireAuth, (req, res) => {
  res.json(
    query(
      `
    SELECT b.*, bk.code as bike_code, s.name as stand_name
    FROM bookings b JOIN bikes bk ON b.bike_id=bk.id JOIN stands s ON b.stand_id=s.id
    WHERE b.user_id=? ORDER BY b.created_at DESC
  `,
      [req.user.id],
    ),
  );
});

app.get("/bookings/:id", requireAuth, (req, res) => {
  const booking = queryOne(
    `
    SELECT b.*, bk.code as bike_code, s.name as stand_name
    FROM bookings b JOIN bikes bk ON b.bike_id=bk.id JOIN stands s ON b.stand_id=s.id
    WHERE b.id=? AND b.user_id=?
  `,
    [req.params.id, req.user.id],
  );
  if (!booking) return res.status(404).json({ error: "Not found" });
  res.json(booking);
});

app.post("/bookings/:id/return", requireAuth, (req, res) => {
  const booking = queryOne("SELECT * FROM bookings WHERE id=? AND user_id=?", [
    req.params.id,
    req.user.id,
  ]);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.status !== "ACTIVE")
    return res.status(400).json({ error: "Booking not active" });

  const bike = queryOne("SELECT * FROM bikes WHERE id=?", [booking.bike_id]);
  const stand = isAtStand(bike);
  if (!stand)
    return res.status(400).json({
      error: "Bike is not near any stand. Bring it to a stand first.",
    });

  run("UPDATE bookings SET status='COMPLETED',returned_at=? WHERE id=?", [
    now(),
    booking.id,
  ]);
  run("UPDATE bikes SET status='AVAILABLE',stand_id=? WHERE id=?", [
    stand.id,
    bike.id,
  ]);
  publishLockCommand(bike.id);
  res.json({ message: "Bike returned successfully" });
});

// ── Stand OTP ─────────────────────────────────────────────────────────────────

app.post("/stand/otp", requireApiKey, (req, res) => {
  const { bikeId, otp } = req.body;
  const booking = queryOne(
    "SELECT * FROM bookings WHERE bike_id=? AND status='PENDING_OTP'",
    [bikeId],
  );
  if (!booking)
    return res.status(404).json({ error: "No pending booking for this bike" });

  if (now() > booking.otp_expires_at) {
    run("UPDATE bookings SET status='EXPIRED' WHERE id=?", [booking.id]);
    run("UPDATE bikes SET status='AVAILABLE' WHERE id=?", [bikeId]);
    return res.json({ result: "EXPIRED", message: "OTP has expired." });
  }

  if (bcrypt.compareSync(otp, booking.otp_hash)) {
    run(
      "UPDATE bookings SET status='ACTIVE',picked_up_at=?,otp_hash='' WHERE id=?",
      [now(), booking.id],
    );
    run("UPDATE bikes SET status='IN_USE' WHERE id=?", [bikeId]);
    console.log(`[STAND] Bike #${bikeId} unlocked ✓`);
    return res.json({ result: "UNLOCKED", message: "Bike unlocked!" });
  }

  const attempts = booking.otp_attempts + 1;
  run("UPDATE bookings SET otp_attempts=? WHERE id=?", [attempts, booking.id]);

  if (attempts >= 3) {
    run("UPDATE bookings SET status='FLAGGED' WHERE id=?", [booking.id]);
    run("UPDATE bikes SET status='AVAILABLE' WHERE id=?", [bikeId]);
    run(
      "INSERT INTO alerts (type,booking_id,message) VALUES ('OTP_BRUTE_FORCE',?,?)",
      [
        booking.id,
        `3 failed OTP attempts on bike #${bikeId}. Possible unauthorized access.`,
      ],
    );
    console.log(`[ALERT] Brute force on bike #${bikeId} — guard alerted!`);
    return res.json({
      result: "LOCKED",
      message: "Too many wrong attempts. Guard alerted.",
    });
  }

  res.json({
    result: "WRONG",
    message: `Wrong OTP. ${3 - attempts} attempt(s) remaining.`,
  });
});

// ── GPS Ping ──────────────────────────────────────────────────────────────────

app.post("/bike/gps", requireApiKey, (req, res) => {
  const { bikeId, lat, lng, battery } = req.body;
  handleGpsPing(bikeId, lat, lng, battery);
  res.json({ message: "Location updated" });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.get("/admin/alerts", requireAdmin, (req, res) => {
  res.json(
    query(`
    SELECT a.*, u.name as user_name, u.id as user_id, bk.code as bike_code
    FROM alerts a
    LEFT JOIN bookings b ON a.booking_id=b.id
    LEFT JOIN users u ON b.user_id=u.id
    LEFT JOIN bikes bk ON b.bike_id=bk.id
    ORDER BY a.created_at DESC
  `),
  );
});

app.get("/admin/bikes", requireAdmin, (req, res) => {
  res.json(
    query(`
    SELECT bk.*, s.name as stand_name FROM bikes bk LEFT JOIN stands s ON bk.stand_id=s.id
  `),
  );
});

app.get("/admin/users", requireAdmin, (req, res) => {
  res.json(
    query("SELECT id,college_id,name,email,is_admin,is_banned FROM users"),
  );
});

app.post("/admin/unban/:userId", requireAdmin, (req, res) => {
  run("UPDATE users SET is_banned=0 WHERE id=?", [req.params.userId]);
  res.json({ message: "User unbanned" });
});

app.post("/admin/alerts/:id/resolve", requireAdmin, (req, res) => {
  run("UPDATE alerts SET resolved=1 WHERE id=?", [req.params.id]);
  res.json({ message: "Alert resolved" });
});

app.get("/admin/bookings", requireAdmin, (req, res) => {
  res.json(
    query(`
    SELECT b.*, u.name as user_name, u.college_id, bk.code as bike_code, s.name as stand_name
    FROM bookings b
    JOIN users u ON b.user_id=u.id
    JOIN bikes bk ON b.bike_id=bk.id
    JOIN stands s ON b.stand_id=s.id
    ORDER BY b.created_at DESC
  `),
  );
});

// Returns GPS trail for all currently active bookings, keyed by booking_id
app.get("/admin/bike-paths", requireAdmin, (req, res) => {
  const active = query(
    "SELECT id FROM bookings WHERE status='ACTIVE'",
  );
  const result = {};
  for (const b of active) {
    result[b.id] = query(
      "SELECT lat, lng FROM bike_gps_history WHERE booking_id=? ORDER BY recorded_at ASC",
      [b.id],
    );
  }
  res.json(result);
});

// Returns only bikes currently IN_USE with their last known GPS
app.get("/admin/live-bikes", requireAdmin, (req, res) => {
  res.json(
    query(`
    SELECT bk.id, bk.code, bk.last_lat, bk.last_lng,
           u.name as user_name, u.college_id,
           b.return_by, b.picked_up_at, b.id as booking_id
    FROM bikes bk
    JOIN bookings b ON b.bike_id=bk.id AND b.status='ACTIVE'
    JOIN users u ON b.user_id=u.id
    WHERE bk.status='IN_USE'
  `),
  );
});

// ── Overdue Checker ───────────────────────────────────────────────────────────

function checkOverdue() {
  const active = query("SELECT * FROM bookings WHERE status='ACTIVE'");
  for (const booking of active) {
    const t = now();
    if (t <= booking.return_by) continue;

    const bike = queryOne("SELECT * FROM bikes WHERE id=?", [booking.bike_id]);
    const stand = isAtStand(bike);

    if (stand) {
      run("UPDATE bookings SET status='COMPLETED',returned_at=? WHERE id=?", [
        t,
        booking.id,
      ]);
      run("UPDATE bikes SET status='AVAILABLE',stand_id=? WHERE id=?", [
        stand.id,
        bike.id,
      ]);
      publishLockCommand(bike.id);
      console.log(
        `[OVERDUE] Booking #${booking.id} auto-completed at ${stand.name}`,
      );
      continue;
    }

    const overdueSeconds = t - booking.return_by;
    const alreadyUserAlerted = queryOne(
      "SELECT id FROM alerts WHERE booking_id=? AND type='OVERDUE_USER'",
      [booking.id],
    );

    if (!alreadyUserAlerted) {
      run(
        "INSERT INTO alerts (type,booking_id,message) VALUES ('OVERDUE_USER',?,?)",
        [
          booking.id,
          `Bike ${bike.code} is overdue. Please return it immediately.`,
        ],
      );
      const user = queryOne("SELECT * FROM users WHERE id=?", [
        booking.user_id,
      ]);
      console.log(
        `[EMAIL → ${user.email}] Your bike ${bike.code} is overdue! Return it now.`,
      );
      continue;
    }

    if (overdueSeconds > 900) {
      const alreadyGuardAlerted = queryOne(
        "SELECT id FROM alerts WHERE booking_id=? AND type='OVERDUE_GUARD'",
        [booking.id],
      );
      if (alreadyGuardAlerted) continue;

      run(
        "INSERT INTO alerts (type,booking_id,message) VALUES ('OVERDUE_GUARD',?,?)",
        [
          booking.id,
          `GUARD ALERT: ${bike.code} is ${Math.floor(overdueSeconds / 60)}min overdue. GPS: (${bike.last_lat},${bike.last_lng})`,
        ],
      );
      run("UPDATE bikes SET status='MISSING' WHERE id=?", [bike.id]);
      run("UPDATE users SET is_banned=1 WHERE id=?", [booking.user_id]);
      const user = queryOne("SELECT * FROM users WHERE id=?", [
        booking.user_id,
      ]);
      console.log(
        `[GUARD ALERT] ${bike.code} missing. Last GPS: (${bike.last_lat},${bike.last_lng}). User ${user.name} banned.`,
      );
    }
  }
}

setInterval(checkOverdue, 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  const { initDb } = require("./db");
  await initDb();
  app.listen(3000, () => {
    console.log("CBSS running on http://localhost:3000");
  });
}

start();
