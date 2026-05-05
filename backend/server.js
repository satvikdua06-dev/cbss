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

const CAMPUS_POLYGON = [
  [26.8495, 75.799],
  [26.853, 75.799],
  [26.853, 75.8025],
  [26.8495, 75.8025],
];

const STAND_RESULT_STATES = new Set([
  "UNLOCKED",
  "WRONG",
  "LOCKED",
  "EXPIRED",
  "NO_BOOKING",
  "ERROR",
]);

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: "cbss-server-" + Math.random().toString(16).slice(2, 10),
});

mqttClient.on("connect", () => {
  const topics = [
    "cbss/stand/+/otp",
    "cbss/stand/+/status",
    "cbss/bike/+/location",
    "cbss/bike/+/gps",
    "cbss/bike/+/status",
  ];

  topics.forEach((topic) => mqttClient.subscribe(topic));
  console.log("[MQTT] Connected - subscribed to stand and bike device topics");
});

mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const parts = topic.split("/");

    if (parts[0] !== "cbss") return;

    if (parts[1] === "stand") {
      const standTopicId = parts[2];
      if (parts[3] === "otp") handleStandOtpTopic(standTopicId, data);
      if (parts[3] === "status") handleStandStatusTopic(standTopicId, data);
      return;
    }

    if (parts[1] === "bike") {
      const bikeTopicId = parts[2];
      if (parts[3] === "location" || parts[3] === "gps") {
        handleBikeLocationTopic(bikeTopicId, data);
      }
      if (parts[3] === "status") handleBikeStatusTopic(bikeTopicId, data);
    }
  } catch (error) {
    console.error("[MQTT] Bad message on", topic, error.message);
  }
});

mqttClient.on("error", (err) => console.error("[MQTT] Error:", err.message));

function mqttPublish(topic, payload) {
  mqttClient.publish(topic, JSON.stringify(payload));
}

function logStandEvent(standId, eventType, payload) {
  run(
    "INSERT INTO stand_events (stand_id,event_type,payload) VALUES (?,?,?)",
    [standId, eventType, JSON.stringify(payload)],
  );
}

function logBikeEvent(bikeId, eventType, payload) {
  run(
    "INSERT INTO bike_events (bike_id,event_type,payload) VALUES (?,?,?)",
    [bikeId, eventType, JSON.stringify(payload)],
  );
}

function publishLockCommand(bikeId, command = "lock") {
  const bike = findBikeByAnyId(bikeId);
  if (!bike) return;

  mqttPublish(`cbss/bike/${bike.esp_topic_id}/command`, {
    bikeId: bike.id,
    bikeCode: bike.code,
    command,
    issuedAt: now(),
  });
  console.log(`[MQTT] ${command} command -> bike #${bike.id} (${bike.code})`);
}

function publishStandResult(standId, result, message, extra = {}) {
  const stand = findStandByAnyId(standId);
  if (!stand) return;

  const payload = {
    standId: stand.id,
    standCode: stand.code,
    result,
    message,
    timestamp: now(),
    ...extra,
  };
  mqttPublish(`cbss/stand/${stand.esp_topic_id}/result`, payload);
  logStandEvent(stand.id, "RESULT_PUBLISHED", payload);
}

function markStandSeen(standId, online = 1) {
  run("UPDATE stands SET last_seen_at=?, online=? WHERE id=?", [
    now(),
    online ? 1 : 0,
    standId,
  ]);
}

function markBikeSeen(bikeId, online = 1) {
  run("UPDATE bikes SET last_seen_at=?, online=? WHERE id=?", [
    now(),
    online ? 1 : 0,
    bikeId,
  ]);
}

function resolveStandForBike(bike) {
  if (!bike || !bike.stand_id) return null;
  return queryOne("SELECT * FROM stands WHERE id=?", [bike.stand_id]);
}

function findStandByAnyId(identifier) {
  return (
    queryOne("SELECT * FROM stands WHERE id=?", [identifier]) ||
    queryOne("SELECT * FROM stands WHERE code=?", [identifier]) ||
    queryOne("SELECT * FROM stands WHERE esp_topic_id=?", [String(identifier)])
  );
}

function findBikeByAnyId(identifier) {
  return (
    queryOne("SELECT * FROM bikes WHERE id=?", [identifier]) ||
    queryOne("SELECT * FROM bikes WHERE code=?", [identifier]) ||
    queryOne("SELECT * FROM bikes WHERE esp_topic_id=?", [String(identifier)])
  );
}

function findPendingBookingsForStand(standId) {
  return query(
    `SELECT b.*, bk.code as bike_code, bk.esp_topic_id as bike_topic_id
     FROM bookings b
     JOIN bikes bk ON b.bike_id = bk.id
     WHERE bk.stand_id = ? AND b.status = 'PENDING_OTP'
     ORDER BY b.created_at ASC`,
    [standId],
  );
}

function expirePendingBooking(booking) {
  run("UPDATE bookings SET status='EXPIRED' WHERE id=?", [booking.id]);
  run("UPDATE bikes SET status='AVAILABLE', lock_state='LOCKED' WHERE id=?", [
    booking.bike_id,
  ]);
}

function unlockBooking(booking, stand) {
  const t = now();
  run(
    "UPDATE bookings SET status='ACTIVE',picked_up_at=?,otp_hash='' WHERE id=?",
    [t, booking.id],
  );
  run(
    "UPDATE bikes SET status='IN_USE', stand_id=NULL, lock_state='UNLOCKED' WHERE id=?",
    [booking.bike_id],
  );
  publishLockCommand(booking.bike_id, "unlock");
  publishStandResult(stand.id, "UNLOCKED", "Bike unlocked!", {
    bikeId: booking.bike_id,
    bikeCode: booking.bike_code,
    bookingId: booking.id,
  });
  console.log(
    `[STAND ${stand.id}] Bike #${booking.bike_id} unlocked via keypad`,
  );
}

function failBookingOtp(booking, stand) {
  const attempts = booking.otp_attempts + 1;
  run("UPDATE bookings SET otp_attempts=? WHERE id=?", [attempts, booking.id]);

  if (attempts >= 3) {
    run("UPDATE bookings SET status='FLAGGED' WHERE id=?", [booking.id]);
    run("UPDATE bikes SET status='AVAILABLE', lock_state='LOCKED' WHERE id=?", [
      booking.bike_id,
    ]);
    run(
      "INSERT INTO alerts (type,booking_id,message) VALUES ('OTP_BRUTE_FORCE',?,?)",
      [
        booking.id,
        `3 failed OTP attempts at stand #${stand.id} for ${booking.bike_code}. Possible unauthorized access.`,
      ],
    );
    publishStandResult(
      stand.id,
      "LOCKED",
      "Too many wrong attempts. Guard alerted.",
      {
        bikeId: booking.bike_id,
        bikeCode: booking.bike_code,
        bookingId: booking.id,
      },
    );
    console.log(`[STAND ${stand.id}] Brute force detected`);
    return;
  }

  publishStandResult(
    stand.id,
    "WRONG",
    `Wrong OTP. ${3 - attempts} attempt(s) remaining.`,
    {
      bikeId: booking.bike_id,
      bikeCode: booking.bike_code,
      bookingId: booking.id,
    },
  );
}

function handleStandOtp(standId, otp, metadata = {}) {
  const stand = findStandByAnyId(standId);
  if (!stand) return { result: "ERROR", message: "Unknown stand." };

  markStandSeen(stand.id, 1);
  logStandEvent(stand.id, "OTP_RECEIVED", { otp, ...metadata });

  if (!otp || !/^\d{6}$/.test(String(otp))) {
    publishStandResult(stand.id, "ERROR", "OTP must be 6 digits.");
    return { result: "ERROR", message: "OTP must be 6 digits." };
  }

  const bookings = findPendingBookingsForStand(stand.id);
  if (!bookings.length) {
    publishStandResult(
      stand.id,
      "NO_BOOKING",
      "No pending booking at this stand.",
    );
    return { result: "NO_BOOKING", message: "No pending booking at this stand." };
  }

  const t = now();
  let activeCandidates = 0;

  for (const booking of bookings) {
    if (t > booking.otp_expires_at) {
      expirePendingBooking(booking);
      continue;
    }

    activeCandidates += 1;
    if (bcrypt.compareSync(String(otp), booking.otp_hash)) {
      unlockBooking(booking, stand);
      return {
        result: "UNLOCKED",
        message: "Bike unlocked!",
        bikeId: booking.bike_id,
        bikeCode: booking.bike_code,
        bookingId: booking.id,
      };
    }

    failBookingOtp(booking, stand);
    return {
      result: activeCandidates >= 0 ? "WRONG" : "ERROR",
      message: "Wrong OTP.",
    };
  }

  publishStandResult(stand.id, "EXPIRED", "OTP expired. Please make a new booking.");
  return { result: "EXPIRED", message: "OTP expired. Please make a new booking." };
}

function handleStandOtpTopic(standTopicId, data) {
  handleStandOtp(data.standId || standTopicId, data.otp, {
    standCode: data.standCode,
    deviceId: data.deviceId,
  });
}

function handleStandStatusTopic(standTopicId, data) {
  const stand = findStandByAnyId(data.standId || standTopicId);
  if (!stand) return;

  markStandSeen(stand.id, data.online === false ? 0 : 1);
  logStandEvent(stand.id, "STATUS", data);
}

function handleBikeLocationTopic(bikeTopicId, data) {
  const bike = findBikeByAnyId(data.bikeId || data.bikeCode || bikeTopicId);
  if (!bike) return;

  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const battery = data.battery == null ? null : Number(data.battery);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  handleGpsPing(bike.id, lat, lng, Number.isFinite(battery) ? battery : null);
}

function handleBikeStatusTopic(bikeTopicId, data) {
  const bike = findBikeByAnyId(data.bikeId || data.bikeCode || bikeTopicId);
  if (!bike) return;

  markBikeSeen(bike.id, data.online === false ? 0 : 1);

  const updates = [];
  const params = [];

  if (data.lockState) {
    updates.push("lock_state=?");
    params.push(String(data.lockState).toUpperCase());
  }

  if (data.battery != null && Number.isFinite(Number(data.battery))) {
    updates.push("battery_level=?");
    params.push(Number(data.battery));
  }

  if (updates.length) {
    params.push(bike.id);
    run(`UPDATE bikes SET ${updates.join(", ")} WHERE id=?`, params);
  }

  logBikeEvent(bike.id, "STATUS", data);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isAtStand(bike) {
  if (bike.last_lat == null || bike.last_lng == null) return null;
  const stands = query("SELECT * FROM stands");
  return (
    stands.find(
      (stand) =>
        haversineMeters(bike.last_lat, bike.last_lng, stand.lat, stand.lng) < 30,
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
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function findTrackableBookingForBike(bikeId) {
  return queryOne(
    "SELECT id, status FROM bookings WHERE bike_id=? AND status IN ('ACTIVE','FLAGGED') ORDER BY created_at DESC LIMIT 1",
    [bikeId],
  );
}

function handleGpsPing(bikeId, lat, lng, battery) {
  const bike = findBikeByAnyId(bikeId);
  if (!bike) return;

  markBikeSeen(bike.id, 1);

  if (battery != null) {
    run(
      "UPDATE bikes SET last_lat=?,last_lng=?,battery_level=? WHERE id=?",
      [lat, lng, battery, bike.id],
    );
    if (battery < 20 && (bike.battery_level == null || bike.battery_level >= 20)) {
      run("INSERT INTO alerts (type,message) VALUES ('LOW_BATTERY',?)", [
        `Bike ${bike.code} battery at ${battery}%. Needs charging.`,
      ]);
      console.log(`[ALERT] Low battery - ${bike.code}: ${battery}%`);
    }
  } else {
    run("UPDATE bikes SET last_lat=?,last_lng=? WHERE id=?", [lat, lng, bike.id]);
  }

  logBikeEvent(bike.id, "LOCATION", { lat, lng, battery });

  const booking = findTrackableBookingForBike(bike.id);
  if (booking) {
    run(
      "INSERT INTO bike_gps_history (bike_id,booking_id,lat,lng) VALUES (?,?,?,?)",
      [bike.id, booking.id, lat, lng],
    );
  }

  if (bike.status === "AVAILABLE" && bike.stand_id) {
    const stand = resolveStandForBike(bike);
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
          console.log(`[ALERT] Tamper - ${bike.code} is ${Math.round(dist)}m from stand`);
        }
      }
    }
  }

  if ((bike.status === "IN_USE" || bike.status === "MISSING") && booking) {
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
        run("UPDATE bikes SET status='MISSING' WHERE id=?", [bike.id]);
        console.log(`[ALERT] Geofence breach - ${bike.code}`);
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
    if (!req.user.is_admin) {
      return res.status(403).json({ error: "Admin only" });
    }
    next();
  });
}

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

app.post("/register", async (req, res) => {
  const { collegeId, name, email, password } = req.body;
  if (!collegeId || !name || !email || !password) {
    return res.status(400).json({ error: "All fields required" });
  }

  if (
    queryOne("SELECT id FROM users WHERE college_id=? OR email=?", [
      collegeId,
      email,
    ])
  ) {
    return res
      .status(409)
      .json({ error: "College ID or email already registered" });
  }

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
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (user.is_banned) {
    return res.status(403).json({ error: "Your account has been banned" });
  }

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

app.get("/stands", (req, res) => {
  const stands = query("SELECT * FROM stands ORDER BY id");
  res.json(
    stands.map((stand) => ({
      ...stand,
      available_bikes: queryOne(
        "SELECT COUNT(*) as c FROM bikes WHERE stand_id=? AND status='AVAILABLE'",
        [stand.id],
      ).c,
      booked_bikes: queryOne(
        "SELECT COUNT(*) as c FROM bikes WHERE stand_id=? AND status='BOOKED'",
        [stand.id],
      ).c,
    })),
  );
});

app.get("/stands/:id/bikes", (req, res) => {
  const stand = findStandByAnyId(req.params.id);
  if (!stand) return res.status(404).json({ error: "Stand not found" });

  res.json(
    query(
      "SELECT id, code, status, battery_level, online, lock_state FROM bikes WHERE stand_id=? ORDER BY id",
      [stand.id],
    ),
  );
});

app.get("/system/topology", requireAdmin, (req, res) => {
  res.json({
    server: {
      role: "raspberry-pi",
      mqttBroker: MQTT_BROKER,
      apiBaseUrl: "http://localhost:3000",
    },
    stands: query(
      "SELECT id, code, name, esp_topic_id, online, last_seen_at FROM stands ORDER BY id",
    ),
    bikes: query(
      "SELECT id, code, esp_topic_id, stand_id, status, lock_state, online, last_seen_at FROM bikes ORDER BY id",
    ),
  });
});

app.post("/bookings", requireAuth, (req, res) => {
  const { bikeId, returnMinutes } = req.body;
  if (![15, 30, 60].includes(Number(returnMinutes))) {
    return res
      .status(400)
      .json({ error: "returnMinutes must be 15, 30, or 60" });
  }

  const user = queryOne("SELECT * FROM users WHERE id=?", [req.user.id]);
  if (user.is_banned) return res.status(403).json({ error: "You are banned" });

  if (
    queryOne(
      "SELECT id FROM bookings WHERE user_id=? AND status IN ('PENDING_OTP','ACTIVE')",
      [req.user.id],
    )
  ) {
    return res.status(409).json({ error: "You already have an active booking" });
  }

  const bike = findBikeByAnyId(bikeId);
  if (!bike || bike.status !== "AVAILABLE") {
    return res.status(400).json({ error: "Bike not available" });
  }

  const stand = resolveStandForBike(bike);
  if (!stand) {
    return res.status(400).json({ error: "Bike is not assigned to any stand" });
  }

  const otp = generateOTP();
  const otpHash = bcrypt.hashSync(otp, 10);
  const t = now();
  const result = run(
    `INSERT INTO bookings (user_id,bike_id,stand_id,status,otp_hash,otp_expires_at,return_by)
     VALUES (?,?,?,'PENDING_OTP',?,?,?)`,
    [req.user.id, bike.id, stand.id, otpHash, t + 600, t + returnMinutes * 60],
  );

  run("UPDATE bikes SET status='BOOKED', lock_state='LOCKED' WHERE id=?", [bike.id]);

  console.log(`[OTP] Booking #${result.lastInsertRowid} for ${user.name} - OTP: ${otp}`);
  res.json({
    bookingId: result.lastInsertRowid,
    otp,
    bikeId: bike.id,
    bikeCode: bike.code,
    standId: stand.id,
    standCode: stand.code,
    standName: stand.name,
    returnMinutes,
  });
});

app.get("/bookings/mine", requireAuth, (req, res) => {
  res.json(
    query(
      `SELECT b.*, bk.code as bike_code, s.name as stand_name, s.code as stand_code
       FROM bookings b
       JOIN bikes bk ON b.bike_id=bk.id
       JOIN stands s ON b.stand_id=s.id
       WHERE b.user_id=?
       ORDER BY b.created_at DESC`,
      [req.user.id],
    ),
  );
});

app.get("/bookings/:id", requireAuth, (req, res) => {
  const booking = queryOne(
    `SELECT b.*, bk.code as bike_code, s.name as stand_name, s.code as stand_code
     FROM bookings b
     JOIN bikes bk ON b.bike_id=bk.id
     JOIN stands s ON b.stand_id=s.id
     WHERE b.id=? AND b.user_id=?`,
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
  if (booking.status !== "ACTIVE") {
    return res.status(400).json({ error: "Booking not active" });
  }

  const bike = queryOne("SELECT * FROM bikes WHERE id=?", [booking.bike_id]);
  const stand = isAtStand(bike);
  if (!stand) {
    return res.status(400).json({
      error: "Bike is not near any stand. Bring it to a stand first.",
    });
  }

  run("UPDATE bookings SET status='COMPLETED',returned_at=? WHERE id=?", [
    now(),
    booking.id,
  ]);
  run(
    "UPDATE bikes SET status='AVAILABLE',stand_id=?,lock_state='LOCKED' WHERE id=?",
    [stand.id, bike.id],
  );
  publishLockCommand(bike.id, "lock");
  res.json({ message: "Bike returned successfully", standId: stand.id });
});

app.post("/stand/otp", requireApiKey, (req, res) => {
  const { standId, otp } = req.body;
  const result = handleStandOtp(standId, otp, { source: "http" });
  const statusCode = STAND_RESULT_STATES.has(result.result) ? 200 : 400;
  res.status(statusCode).json(result);
});

app.post("/bike/gps", requireApiKey, (req, res) => {
  const { bikeId, lat, lng, battery } = req.body;
  handleGpsPing(bikeId, lat, lng, battery);
  res.json({ message: "Location updated" });
});

app.post("/bike/status", requireApiKey, (req, res) => {
  const { bikeId, bikeCode, lockState, battery, online } = req.body;
  handleBikeStatusTopic(bikeId || bikeCode, { bikeId, bikeCode, lockState, battery, online });
  res.json({ message: "Bike status updated" });
});

app.post("/stand/status", requireApiKey, (req, res) => {
  const { standId, standCode, online, state } = req.body;
  handleStandStatusTopic(standId || standCode, { standId, standCode, online, state });
  res.json({ message: "Stand status updated" });
});

app.get("/admin/alerts", requireAdmin, (req, res) => {
  res.json(
    query(`SELECT a.*, u.name as user_name, u.id as user_id, bk.code as bike_code
           FROM alerts a
           LEFT JOIN bookings b ON a.booking_id=b.id
           LEFT JOIN users u ON b.user_id=u.id
           LEFT JOIN bikes bk ON b.bike_id=bk.id
           ORDER BY a.created_at DESC`),
  );
});

app.get("/admin/bikes", requireAdmin, (req, res) => {
  res.json(
    query(`SELECT bk.*, s.name as stand_name, s.code as stand_code
           FROM bikes bk
           LEFT JOIN stands s ON bk.stand_id=s.id
           ORDER BY bk.id`),
  );
});

app.get("/admin/stands", requireAdmin, (req, res) => {
  res.json(
    query(`SELECT s.*,
                  (SELECT COUNT(*) FROM bikes bk WHERE bk.stand_id=s.id) as total_bikes
           FROM stands s
           ORDER BY s.id`),
  );
});

app.get("/admin/devices", requireAdmin, (req, res) => {
  res.json({
    stands: query(
      "SELECT id, code, name, esp_topic_id, online, last_seen_at FROM stands ORDER BY id",
    ),
    bikes: query(
      "SELECT id, code, esp_topic_id, status, lock_state, battery_level, online, last_seen_at FROM bikes ORDER BY id",
    ),
  });
});

app.get("/admin/users", requireAdmin, (req, res) => {
  res.json(query("SELECT id,college_id,name,email,is_admin,is_banned FROM users"));
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
    query(`SELECT b.*, u.name as user_name, u.college_id, bk.code as bike_code, s.name as stand_name, s.code as stand_code
           FROM bookings b
           JOIN users u ON b.user_id=u.id
           JOIN bikes bk ON b.bike_id=bk.id
           JOIN stands s ON b.stand_id=s.id
           ORDER BY b.created_at DESC`),
  );
});

app.get("/admin/bike-paths", requireAdmin, (req, res) => {
  const active = query("SELECT id FROM bookings WHERE status IN ('ACTIVE','FLAGGED')");
  const result = {};
  for (const booking of active) {
    result[booking.id] = query(
      "SELECT lat, lng FROM bike_gps_history WHERE booking_id=? ORDER BY recorded_at ASC",
      [booking.id],
    );
  }
  res.json(result);
});

app.get("/admin/live-bikes", requireAdmin, (req, res) => {
  res.json(
    query(`SELECT bk.id, bk.code, bk.last_lat, bk.last_lng, bk.battery_level, bk.lock_state,
                  u.name as user_name, u.college_id, b.return_by, b.picked_up_at, b.id as booking_id,
                  b.status as booking_status, bk.status as bike_status
           FROM bikes bk
           JOIN bookings b ON b.bike_id=bk.id AND b.status IN ('ACTIVE','FLAGGED')
           JOIN users u ON b.user_id=u.id
           WHERE bk.status IN ('IN_USE','MISSING')`),
  );
});

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
      run(
        "UPDATE bikes SET status='AVAILABLE',stand_id=?,lock_state='LOCKED' WHERE id=?",
        [stand.id, bike.id],
      );
      publishLockCommand(bike.id, "lock");
      console.log(`[OVERDUE] Booking #${booking.id} auto-completed at ${stand.name}`);
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
        [booking.id, `Bike ${bike.code} is overdue. Please return it immediately.`],
      );
      const user = queryOne("SELECT * FROM users WHERE id=?", [booking.user_id]);
      console.log(`[EMAIL -> ${user.email}] Your bike ${bike.code} is overdue! Return it now.`);
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
      const user = queryOne("SELECT * FROM users WHERE id=?", [booking.user_id]);
      console.log(
        `[GUARD ALERT] ${bike.code} missing. Last GPS: (${bike.last_lat},${bike.last_lng}). User ${user.name} banned.`,
      );
    }
  }
}

setInterval(checkOverdue, 60 * 1000);

async function start() {
  await initDb();
  app.listen(3000, () => {
    console.log("CBSS running on http://localhost:3000");
  });
}

start();
