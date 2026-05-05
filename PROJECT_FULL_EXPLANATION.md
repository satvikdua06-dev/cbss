# CBSS Project Full Explanation, Workflow, Commands, And Testing Guide

This document explains the current Campus Bike Sharing System (CBSS) project in a complete, practical way. It is written so you can use it for understanding the code, preparing for viva, running the project on the Raspberry Pi, and testing the full flow with the simulator.

Current practical status:

- The Raspberry Pi backend is implemented using Node.js, Express, SQLite through `sql.js`, JWT authentication, and MQTT.
- The frontend is implemented as a static HTML/CSS/JavaScript web app served by the backend.
- The stand-side ESP firmware is part of the project design and latest git history, but the current local `esp32_stand/stand_keypad/stand_keypad.ino` file may contain a temporary buzzer test sketch. Restore the full stand firmware before flashing a real stand.
- The bike GPS side can currently be tested reliably using `simulator.py`. Real ESP8266/NEO-6M GPS work is being left aside for now.
- The 12-sensor and cloud integration parts are under development and should be presented as future/ongoing work.

## 1. Project Goal

CBSS is an IoT-based campus bicycle sharing system.

The system allows:

- Students to log in and book an available bike from a stand.
- The backend to generate an OTP for that booking.
- The student to enter the OTP at the stand keypad.
- The stand ESP to send the OTP to the Raspberry Pi server.
- The Raspberry Pi to verify the OTP and unlock the correct bike.
- Bike location/status to be monitored by the backend.
- Admins to view bookings, alerts, bikes, users, and live bike movement.

In short:

```text
Student frontend -> Raspberry Pi backend -> Stand ESP -> Bike unlock
Bike telemetry/simulator -> Raspberry Pi backend -> Admin live map
```

## 2. Folder And File Structure

```text
cbss/
  backend/
    server.js
    db.js
    package.json
    package-lock.json
    cbss.db

  frontend/
    index.html
    app.js
    style.css

  esp32_stand/
    stand_keypad/
      stand_keypad.ino

  esp32_bike/
    bike_tracker/
      bike_tracker.ino

  simulator.py
  README.md
  PROJECT_FULL_EXPLANATION.md
```

Explanation:

- `backend/server.js`: Main server file. Handles APIs, MQTT messages, OTP verification, booking logic, alerts, live map data, and overdue checks.
- `backend/db.js`: Creates and manages the SQLite database using `sql.js`. Also seeds default users, stands, and bikes.
- `backend/package.json`: Lists Node.js dependencies and the start script.
- `frontend/index.html`: Defines the student and admin web interface structure.
- `frontend/app.js`: Contains all frontend logic such as login, booking, OTP display, admin tabs, and live map refresh.
- `frontend/style.css`: Contains the UI styling.
- `simulator.py`: Simulates stand OTP entry and bike GPS/location updates.
- `esp32_stand/stand_keypad/stand_keypad.ino`: Stand ESP firmware. It should read keypad OTPs and talk to backend over MQTT.
- `esp32_bike/bike_tracker/bike_tracker.ino`: Bike GPS telemetry firmware experiment. Real GPS testing is currently being left aside.

## 3. System Architecture

CBSS has four main layers.

### 3.1 Device Layer

Devices:

- Raspberry Pi: central server.
- Stand ESP: one controller per stand.
- Bike ESP or simulator: sends bike location/status.

Stand ESP responsibilities:

- Read OTP from keypad.
- Show messages on LCD.
- Send OTP to backend over MQTT.
- Receive result from backend.
- Show success/error feedback.

Bike telemetry responsibilities:

- Send location updates.
- Send battery/status updates.
- Receive lock/unlock commands.

For current project testing, the bike is usually simulated with `simulator.py`.

### 3.2 Communication Layer

Communication methods:

- HTTP/REST: browser frontend talks to backend.
- MQTT: ESP devices and simulator talk to backend.
- SQLite database: backend stores system state locally.

MQTT broker:

```text
broker.hivemq.com
```

Main MQTT topics:

```text
cbss/stand/{standId}/otp
cbss/stand/{standId}/status
cbss/stand/{standId}/result
cbss/bike/{bikeId}/location
cbss/bike/{bikeId}/gps
cbss/bike/{bikeId}/status
cbss/bike/{bikeId}/command
```

### 3.3 Backend Layer

The Raspberry Pi backend:

- Runs Node.js and Express.
- Serves the frontend.
- Handles login/register.
- Creates bookings and OTPs.
- Verifies OTPs from stands.
- Tracks bikes and stands.
- Creates alerts for misuse.
- Provides admin APIs.

### 3.4 Application Layer

The web app has:

- Student login/register.
- Student home page with stands and bike availability.
- Booking and OTP display.
- Booking history.
- Admin alerts page.
- Admin bookings page.
- Admin live map.
- Admin bikes page.
- Admin users page.

## 4. Backend Dependencies

Defined in `backend/package.json`.

```json
{
  "express": "web server and API framework",
  "cors": "allows browser requests",
  "bcryptjs": "hashes passwords and OTPs",
  "jsonwebtoken": "creates and verifies login tokens",
  "sql.js": "SQLite database in JavaScript",
  "mqtt": "connects backend to MQTT broker"
}
```

Install command:

```bash
cd ~/Desktop/cbss/backend
npm install
```

Run command:

```bash
node server.js
```

or:

```bash
npm start
```

## 5. Database Explanation: `backend/db.js`

`db.js` is responsible for creating, migrating, seeding, reading, writing, and saving the database.

### 5.1 Imports

```js
const initSqlJs = require("sql.js");
const fs = require("fs");
const bcrypt = require("bcryptjs");
```

Line-by-line explanation:

- `sql.js` gives SQLite database support in Node.js.
- `fs` reads and writes the database file.
- `bcryptjs` hashes seeded passwords.

### 5.2 Database File And Variable

```js
const DB_FILE = "./cbss.db";
let db;
```

Explanation:

- `DB_FILE` is the local database file.
- `db` stores the active SQL database instance.

### 5.3 `initDb()`

Purpose:

- Load existing `cbss.db` if it exists.
- Create a new database if it does not exist.
- Create required tables.
- Run migrations.
- Seed demo data.
- Save the database.

Main logic:

```js
const SQL = await initSqlJs();
if (fs.existsSync(DB_FILE)) {
  db = new SQL.Database(fs.readFileSync(DB_FILE));
} else {
  db = new SQL.Database();
}
```

Line-by-line explanation:

- Initialize the SQL engine.
- If `cbss.db` exists, read it from disk.
- If not, create a fresh database.

### 5.4 Tables Created

`users` table:

- Stores students and admins.
- Important fields: `college_id`, `name`, `email`, `password_hash`, `is_admin`, `is_banned`.

`stands` table:

- Stores stand location and ESP metadata.
- Important fields: `code`, `name`, `lat`, `lng`, `esp_topic_id`, `online`, `last_seen_at`.

`bikes` table:

- Stores bike state and location.
- Important fields: `code`, `status`, `stand_id`, `esp_topic_id`, `lock_state`, `last_lat`, `last_lng`, `battery_level`, `online`.

`bookings` table:

- Stores every bike booking.
- Important fields: `user_id`, `bike_id`, `stand_id`, `status`, `otp_hash`, `otp_attempts`, `otp_expires_at`, `return_by`, `picked_up_at`, `returned_at`.

`alerts` table:

- Stores admin alerts.
- Alert types include `OTP_BRUTE_FORCE`, `TAMPER`, `LOW_BATTERY`, `OUT_OF_BOUNDS`, `OVERDUE_USER`, and `OVERDUE_GUARD`.

`bike_gps_history` table:

- Stores location trail points for active/flagged bookings.

`stand_events` table:

- Logs stand MQTT/status/result events.

`bike_events` table:

- Logs bike location/status events.

### 5.5 `migrate()`

Purpose:

- Adds new columns to old databases without deleting old data.

Important behavior:

```js
try {
  db.run(sql);
} catch {}
```

Explanation:

- If a column already exists, SQLite throws an error.
- The error is ignored because that means the migration was already applied.

### 5.6 `save()`

```js
fs.writeFileSync(DB_FILE, db.export());
```

Explanation:

- Converts the in-memory SQL database to bytes.
- Writes those bytes into `cbss.db`.

### 5.7 `query(sql, params)`

Purpose:

- Run a SELECT query and return all rows.

Line-by-line behavior:

- Prepare the SQL statement.
- Bind parameters safely.
- Step through every result row.
- Convert each row into a JavaScript object.
- Free the statement.
- Return the rows.

### 5.8 `queryOne(sql, params)`

Purpose:

- Return the first row from a query.
- Return `null` if no row exists.

### 5.9 `run(sql, params)`

Purpose:

- Run INSERT/UPDATE/DELETE queries.
- Save database after every write.
- Return the last inserted row id.

### 5.10 `seed()`

Purpose:

- Create demo data when database is empty.

Seeded stands:

```text
STAND-001: Main Gate Stand
STAND-002: Library Stand
```

Seeded bikes:

```text
BIKE-001 and BIKE-002 at STAND-001
BIKE-003 and BIKE-004 at STAND-002
```

Seeded accounts:

```text
ADMIN001 / admin123
STU001   / pass123
STU002   / pass123
```

### 5.11 `backfillDeviceMetadata()`

Purpose:

- Ensures older databases get `code`, `esp_topic_id`, and `lock_state` values.

This matters because the project changed from a simple bike-sharing system into a multi-device system with stand ESPs and bike ESPs.

## 6. Backend Explanation: `backend/server.js`

`server.js` is the main brain of CBSS.

### 6.1 Imports

```js
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const mqtt = require("mqtt");
const { initDb, query, queryOne, run } = require("./db");
```

Line-by-line explanation:

- `express`: creates the HTTP server.
- `cors`: allows frontend requests.
- `bcryptjs`: hashes passwords and compares OTPs.
- `jsonwebtoken`: creates login tokens.
- `path`: builds frontend folder path.
- `mqtt`: connects to the MQTT broker.
- `initDb`, `query`, `queryOne`, `run`: database helper functions.

### 6.2 Express Setup

```js
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));
```

Explanation:

- Creates the Express app.
- Enables CORS.
- Allows JSON request bodies.
- Serves the frontend files from the `frontend` folder.

### 6.3 Constants

```js
const JWT_SECRET = "cbss-secret-key";
const INTERNAL_API_KEY = "cbss-internal-key-123";
const MQTT_BROKER = "mqtt://broker.hivemq.com";
```

Explanation:

- `JWT_SECRET`: signs login tokens.
- `INTERNAL_API_KEY`: protects internal simulator/device HTTP endpoints.
- `MQTT_BROKER`: public MQTT broker used by backend and devices.

For production, these should be moved into environment variables.

### 6.4 Campus Polygon

```js
const CAMPUS_POLYGON = [
  [26.8495, 75.799],
  [26.853, 75.799],
  [26.853, 75.8025],
  [26.8495, 75.8025],
];
```

Explanation:

- These coordinates define the allowed campus boundary.
- If a bike goes outside this polygon, the backend creates an out-of-bounds alert.

### 6.5 MQTT Connection

```js
const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: "cbss-server-" + Math.random().toString(16).slice(2, 10),
});
```

Explanation:

- Connects the backend to HiveMQ.
- Uses a random client id so multiple test runs do not clash.

### 6.6 MQTT Subscribe On Connect

The backend subscribes to:

```text
cbss/stand/+/otp
cbss/stand/+/status
cbss/bike/+/location
cbss/bike/+/gps
cbss/bike/+/status
```

Explanation:

- `+` is an MQTT wildcard.
- It lets the server listen to all stands and bikes.
- Example: `cbss/stand/1/otp` and `cbss/stand/2/otp` are both accepted.

### 6.7 MQTT Message Router

Purpose:

- Parse incoming MQTT JSON.
- Split the topic.
- Send the message to the correct handler.

Flow:

```text
MQTT message arrives
-> parse JSON
-> split topic by "/"
-> if stand OTP, call handleStandOtpTopic()
-> if stand status, call handleStandStatusTopic()
-> if bike location/GPS, call handleBikeLocationTopic()
-> if bike status, call handleBikeStatusTopic()
```

### 6.8 `mqttPublish(topic, payload)`

Purpose:

- Convert JavaScript object to JSON.
- Publish it to MQTT.

### 6.9 Event Logging Helpers

`logStandEvent()`:

- Inserts stand events into `stand_events`.

`logBikeEvent()`:

- Inserts bike events into `bike_events`.

These are useful for debugging and audit history.

### 6.10 `publishLockCommand(bikeId, command)`

Purpose:

- Sends `lock` or `unlock` command to a bike.

Topic:

```text
cbss/bike/{bikeTopicId}/command
```

Payload example:

```json
{
  "bikeId": 1,
  "bikeCode": "BIKE-001",
  "command": "unlock",
  "issuedAt": 1710000000
}
```

### 6.11 `publishStandResult(standId, result, message, extra)`

Purpose:

- Sends result back to stand ESP.

Topic:

```text
cbss/stand/{standTopicId}/result
```

Possible results:

```text
UNLOCKED
WRONG
LOCKED
EXPIRED
NO_BOOKING
ERROR
```

### 6.12 `markStandSeen()` And `markBikeSeen()`

Purpose:

- Update `last_seen_at`.
- Set device `online` state.

This helps admin know whether devices are active.

### 6.13 Lookup Helpers

`findStandByAnyId(identifier)`:

- Finds a stand by numeric id, stand code, or ESP topic id.

`findBikeByAnyId(identifier)`:

- Finds a bike by numeric id, bike code, or ESP topic id.

This makes MQTT and HTTP flexible because devices may send either id or code.

### 6.14 `findPendingBookingsForStand(standId)`

Purpose:

- Finds all bookings at a stand that are waiting for OTP.

Important condition:

```sql
WHERE bk.stand_id = ? AND b.status = 'PENDING_OTP'
```

This means only bikes currently docked at that stand can be unlocked from that stand.

### 6.15 `expirePendingBooking(booking)`

Purpose:

- Marks booking as `EXPIRED`.
- Makes the bike `AVAILABLE` again.
- Keeps bike locked.

### 6.16 `unlockBooking(booking, stand)`

Purpose:

- Converts a pending booking into an active ride.

Step-by-step:

1. Set booking status to `ACTIVE`.
2. Save pickup time.
3. Clear OTP hash so it cannot be reused.
4. Set bike status to `IN_USE`.
5. Remove bike from stand by setting `stand_id=NULL`.
6. Set bike lock state to `UNLOCKED`.
7. Publish MQTT unlock command to bike.
8. Publish `UNLOCKED` result to stand.

This is the core unlock logic of the project.

### 6.17 `failBookingOtp(booking, stand)`

Purpose:

- Count wrong OTP attempts.
- Lock/flag booking after 3 wrong attempts.

Behavior:

- Attempt 1 or 2: send `WRONG`.
- Attempt 3: set booking to `FLAGGED`, create alert, send `LOCKED`.

Alert type:

```text
OTP_BRUTE_FORCE
```

### 6.18 `handleStandOtp(standId, otp, metadata)`

This is the most important OTP function.

Step-by-step:

1. Find the stand.
2. Mark stand as online/seen.
3. Log OTP event.
4. Validate that OTP is exactly 6 digits.
5. Find pending bookings at the stand.
6. If no booking exists, send `NO_BOOKING`.
7. For each pending booking:
   - If OTP expired, expire the booking.
   - If OTP matches hash, unlock the booking.
   - If OTP does not match, record a failed attempt.
8. If all pending bookings expired, send `EXPIRED`.

This is why the backend, not the ESP, decides which bike unlocks.

### 6.19 `handleStandOtpTopic()`

Purpose:

- Receives stand MQTT OTP payload.
- Calls `handleStandOtp()`.

Example input:

```json
{
  "standId": 1,
  "standCode": "STAND-001",
  "deviceId": "1",
  "otp": "123456"
}
```

### 6.20 `handleStandStatusTopic()`

Purpose:

- Receives stand online/status updates.
- Marks stand seen.
- Logs stand status event.

### 6.21 `handleBikeLocationTopic()`

Purpose:

- Receives bike GPS/location MQTT data.
- Converts `lat`, `lng`, and `battery` to numbers.
- Calls `handleGpsPing()`.

### 6.22 `handleBikeStatusTopic()`

Purpose:

- Receives bike status updates.
- Updates lock state, battery level, online state.
- Logs bike status.

### 6.23 `haversineMeters()`

Purpose:

- Calculates distance between two GPS points in meters.

Used for:

- Checking if bike is near a stand.
- Detecting tamper movement from a parked stand.

### 6.24 `isAtStand(bike)`

Purpose:

- Checks if bike is within 30 meters of any stand.

Important current behavior:

- It returns the first matching stand within 30 meters.
- It does not force return to original stand.
- This means a bike can be returned to a different stand if it is physically near that stand.

### 6.25 `pointInPolygon()`

Purpose:

- Checks whether bike coordinates are inside campus boundary.

Used for:

- Geofence/out-of-bounds detection.

### 6.26 `findTrackableBookingForBike()`

Purpose:

- Finds the latest `ACTIVE` or `FLAGGED` booking for a bike.

Why:

- Live location should continue even after a bike is flagged/missing.

### 6.27 `handleGpsPing(bikeId, lat, lng, battery)`

This is the main location handler.

Step-by-step:

1. Find bike.
2. Mark bike seen.
3. Update bike last latitude/longitude.
4. Update battery if available.
5. Create low battery alert if battery falls below 20 percent.
6. Log location event.
7. If booking is active/flagged, save GPS history point.
8. If bike is available but moved away from its stand, create tamper alert.
9. If bike is in use/missing and leaves campus, create out-of-bounds alert.
10. On geofence breach, mark booking `FLAGGED` and bike `MISSING`.

This function powers the admin live map, path history, tamper alerts, low battery alerts, and geofence alerts.

### 6.28 `generateOTP()`

Purpose:

- Generates a random 6-digit OTP.

### 6.29 `now()`

Purpose:

- Returns current Unix timestamp in seconds.

### 6.30 Authentication Middleware

`requireAuth()`:

- Reads `Authorization: Bearer <token>`.
- Verifies JWT.
- Attaches user data to `req.user`.

`requireAdmin()`:

- Requires valid login.
- Then checks `is_admin`.

`requireApiKey()`:

- Protects internal simulator/device HTTP routes using `x-api-key`.

### 6.31 Public Auth Routes

`POST /register`:

- Accepts `collegeId`, `name`, `email`, `password`.
- Checks duplicate college ID/email.
- Hashes password.
- Creates user.

`POST /login`:

- Checks college ID and password.
- Rejects banned users.
- Returns JWT token.

`GET /me`:

- Returns logged-in user info.

### 6.32 Student Routes

`GET /stands`:

- Lists all stands.
- Adds available bike count.
- Adds booked bike count.

`GET /stands/:id/bikes`:

- Lists bikes docked at a stand.
- Includes status, battery, online, and lock state.

`POST /bookings`:

- Creates a new booking.
- Validates return time: 15, 30, or 60 minutes.
- Prevents one user from having two active/pending bookings.
- Requires bike to be `AVAILABLE`.
- Generates OTP.
- Stores hashed OTP.
- Sets bike status to `BOOKED`.
- Returns OTP to frontend for demo/testing.

`GET /bookings/mine`:

- Returns current user's booking history.

`GET /bookings/:id`:

- Returns one booking for current user.

`POST /bookings/:id/return`:

- Allows returning an active bike.
- Checks if bike is near any stand.
- Marks booking `COMPLETED`.
- Marks bike `AVAILABLE`.
- Assigns bike to the detected stand.
- Publishes lock command to bike.

### 6.33 Internal Simulator/Device Routes

`POST /stand/otp`:

- Allows simulator to submit OTP over HTTP.
- Protected by `x-api-key`.

`POST /bike/gps`:

- Allows simulator to send GPS over HTTP.
- Protected by `x-api-key`.

`POST /bike/status`:

- Allows simulator/device to send status over HTTP.

`POST /stand/status`:

- Allows simulator/device to send stand status over HTTP.

### 6.34 Admin Routes

`GET /admin/alerts`:

- Shows all alerts with user/bike info.

`GET /admin/bikes`:

- Shows all bikes and their current stand/status/GPS.

`GET /admin/stands`:

- Shows all stands and bike counts.

`GET /admin/devices`:

- Shows stand and bike online/device state.

`GET /admin/users`:

- Shows users.

`POST /admin/unban/:userId`:

- Unbans a banned student.

`POST /admin/alerts/:id/resolve`:

- Marks alert resolved.

`GET /admin/bookings`:

- Shows all bookings for admin.

`GET /admin/bike-paths`:

- Returns GPS path history for active/flagged bookings.

`GET /admin/live-bikes`:

- Returns currently active or flagged bikes that should appear on live map.

### 6.35 `checkOverdue()`

Purpose:

- Runs every 60 seconds.
- Checks active bookings that passed `return_by`.

Behavior:

- If bike is near a stand, auto-complete return.
- If overdue for the first time, create user alert.
- If more than 15 minutes overdue, create guard alert, mark bike missing, and ban user.

### 6.36 Server Start

```js
async function start() {
  await initDb();
  app.listen(3000, () => {
    console.log("CBSS running on http://localhost:3000");
  });
}

start();
```

Explanation:

- Initialize database first.
- Then start server on port `3000`.

## 7. Frontend Structure: `frontend/index.html`

`index.html` defines the visible screens.

### 7.1 Head Section

Purpose:

- Sets page metadata.
- Loads `style.css`.
- Loads Leaflet CSS for the map.

### 7.2 Student Navbar

Contains:

- CBSS brand.
- Home link.
- History link.
- Logout link.

This navbar is hidden until a student logs in.

### 7.3 Admin Navbar

Contains:

- Alerts.
- Bookings.
- Live Map.
- Bikes.
- Users.
- Logout.

This navbar is hidden until an admin logs in.

### 7.4 Auth Page

Contains:

- Login tab.
- Register tab.
- Login form.
- Register form.
- Error/success message area.

### 7.5 Home Page

Contains:

- Active booking banner.
- Stand cards grid.

This is where students select a stand and book bikes.

### 7.6 Booking Page

Contains three states:

- `bookingPending`: shows OTP before pickup.
- `bookingActive`: shows active ride and return button.
- `bookingDone`: shows returned confirmation.

### 7.7 Stand Modal

Opens when student clicks a stand.

Shows:

- Docked bikes.
- Availability status.
- Book button only for available bikes.

### 7.8 Book Confirm Modal

Lets student:

- Confirm selected bike.
- Choose return duration: 15, 30, or 60 minutes.

### 7.9 History Page

Shows current student's booking history.

### 7.10 Admin Page

Contains admin tabs:

- Alerts.
- All bookings.
- Live map.
- Bikes.
- Users.

### 7.11 Scripts

Loads:

```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="app.js"></script>
```

Explanation:

- Leaflet powers the map.
- `app.js` powers all frontend behavior.

## 8. Frontend Logic: `frontend/app.js`

### 8.1 Global Variables

Important variables:

- `API`: backend base URL.
- `token`: JWT token from local storage.
- `currentUser`: logged-in user data.
- `selectedBikeId`: bike chosen for booking.
- `activeBookingId`: user's current booking.
- `otpCountdownTimer`: OTP countdown interval.
- `returnCountdownTimer`: ride return countdown interval.
- `pollTimer`: checks booking status repeatedly.
- `leafletMap`: admin map object.
- `bikeMarkers`, `standMarkers`: map markers.
- `bikePolylines`: GPS path lines.
- `allBookings`: admin bookings cache.
- `mapRefreshTimer`: live map refresh interval.

### 8.2 `window.onload`

Purpose:

- If token exists, try `/me`.
- If token is valid, keep user logged in.
- If token is invalid, logout.

### 8.3 `showLoggedIn()`

Purpose:

- Shows student navbar and home page for students.
- Shows admin navbar and alerts tab for admins.

### 8.4 `apiFetch(path, options)`

Purpose:

- Wrapper around `fetch`.
- Adds JSON headers.
- Adds JWT authorization header.
- Parses JSON response.
- Throws error if request fails.

This keeps the rest of frontend code cleaner.

### 8.5 `showPage(page)`

Purpose:

- Simple page router.
- Hides all pages.
- Shows selected page.
- Loads data when opening home/history.

### 8.6 Authentication Functions

`switchTab(tab)`:

- Shows login form or register form.
- Updates active tab style.
- Clears auth error.

`login()`:

- Reads college ID/password.
- Sends `POST /login`.
- Stores token.
- Shows correct logged-in UI.

`register()`:

- Reads registration form.
- Sends `POST /register`.
- Switches user back to login tab after success.

`logout()`:

- Clears token.
- Clears timers/map layers.
- Hides navbars.
- Shows auth page.

### 8.7 Home Functions

`loadHome()`:

- Loads user's bookings.
- Shows active booking banner if user has pending/active booking.
- Loads stands.
- Displays stand cards with available bike count and stand online/offline state.

`openStand(standId, standName)`:

- Opens stand modal.
- Calls `/stands/:id/bikes`.
- Renders docked bikes.
- Enables Book button only for `AVAILABLE` bikes.

`openBookModal(bikeId, bikeCode)`:

- Saves selected bike.
- Opens booking confirmation modal.

`confirmBooking()`:

- Reads selected return duration.
- Sends `POST /bookings`.
- If successful, displays OTP page.

### 8.8 Booking/OTP Functions

`showBookingPage(data)`:

- Shows OTP received from backend.
- Starts 10-minute OTP countdown.
- Starts polling booking status.

`goToActiveBooking()`:

- Opens existing active or pending booking from banner.

`pollBookingStatus()`:

- Every 3 seconds calls `/bookings/:id`.
- Updates UI when status changes from `PENDING_OTP` to `ACTIVE`, `COMPLETED`, `FLAGGED`, or `EXPIRED`.

`renderBookingState(b)`:

- If booking is active, shows ride screen.
- If completed, shows returned screen.
- If flagged or expired, shows message.

`startReturnCountdown(returnBy)`:

- Shows remaining ride time.
- Shows `OVERDUE` when time passes.

`returnBike()`:

- Calls `POST /bookings/:id/return`.
- Backend only accepts return if bike is near a stand.

### 8.9 Student History

`loadHistory()`:

- Calls `/bookings/mine`.
- Renders booking table.

### 8.10 Admin Tab Functions

`showAdminTab(tab)`:

- Hides all admin tabs.
- Shows selected tab.
- Calls the matching load function.
- Starts map updates only on map tab.

### 8.11 Admin Alerts

`loadAdminAlerts()`:

- Calls `/admin/alerts`.
- Shows alert cards.
- Shows Resolve button for unresolved alerts.

`resolveAlert(id)`:

- Calls `/admin/alerts/:id/resolve`.
- Reloads alerts.

### 8.12 Admin Bookings

`loadAdminBookings()`:

- Calls `/admin/bookings`.
- Stores result in `allBookings`.
- Renders table.

`filterBookings()`:

- Filters bookings by student, college ID, bike code, or status.

`buildBookingTable()`:

- Builds reusable HTML table for student/admin booking lists.

### 8.13 Admin Live Map

`initMap()`:

- Creates Leaflet map once.
- Adds OpenStreetMap tiles.
- Adds stand markers.
- Starts refresh.

`refreshMap()`:

- Calls `/admin/live-bikes`.
- Calls `/admin/bike-paths`.
- Removes old markers.
- Draws bike markers.
- Draws GPS path polylines.
- Updates live map info text.

`bikeIcon(overdue)`:

- Creates bike marker icon.
- Uses red marker when overdue.

`standIcon()`:

- Creates stand marker icon.

### 8.14 Admin Bikes

`loadAdminBikes()`:

- Calls `/admin/bikes`.
- Shows bike code, status, stand, battery, and last GPS.

### 8.15 Admin Users

`loadAdminUsers()`:

- Calls `/admin/users`.
- Shows college ID, name, email, role, and ban status.

`unbanUser(id)`:

- Calls `/admin/unban/:userId`.

### 8.16 Utility Functions

`formatTime(unix)`:

- Converts Unix timestamp to readable Indian date/time.

`batteryHtml(level)`:

- Returns battery display HTML with color based on level.

`esc(str)`:

- Escapes text before inserting into HTML.
- Helps avoid HTML injection.

`copyOTP()`:

- Copies OTP to clipboard.

## 9. CSS Explanation: `frontend/style.css`

The CSS controls the look of the web app.

Main sections:

- Global reset: removes default browser margins and sets box sizing.
- Body style: sets font, background, and text color.
- Navbar: styles student/admin top bars.
- Auth page: centers login/register box.
- Buttons: defines primary, secondary, small, return, copy, and disabled buttons.
- Container: keeps content centered and readable.
- Active banner: highlights current booking.
- Stand grid: displays stands as responsive cards.
- OTP card: styles OTP display and active ride screen.
- Modal: styles stand and booking popups.
- Table: styles booking/history/admin data.
- Badges: colors statuses like active, completed, flagged, expired, missing.
- Admin alerts: styles alert cards.
- Live map: sets Leaflet map height and marker styles.

Important classes:

- `.stand-card`: clickable stand card.
- `.bike-row`: bike row inside modal.
- `.bike-row-disabled`: unavailable bike row.
- `.otp-digits`: large OTP display.
- `.badge-*`: booking/bike status labels.
- `.map-marker`: custom Leaflet marker base.
- `.bike-marker`: bike map marker.
- `.stand-marker`: stand map marker.

## 10. Simulator Explanation: `simulator.py`

The simulator is used when real ESP hardware is not ready.

It has two modes:

```text
stand
bike
```

### 10.1 Imports

```python
import argparse
import json
import math
import random
import sys
import time
import uuid
```

Explanation:

- `argparse`: command-line arguments.
- `json`: build MQTT payloads.
- `math`: GPS distance calculations.
- `random`: fake battery/location noise.
- `sys`: exit on error.
- `time`: delays between pings.
- `uuid`: unique MQTT simulator client id.

### 10.2 Optional Dependencies

```python
import requests
import paho.mqtt.client as mqtt_lib
```

Explanation:

- `requests`: sends HTTP fallback requests to backend.
- `paho-mqtt`: sends MQTT messages to broker.

If MQTT is unavailable, the simulator falls back to HTTP where possible.

### 10.3 Constants

```python
BASE_URL = "http://localhost:3000"
API_KEY = "cbss-internal-key-123"
MQTT_BROKER = "broker.hivemq.com"
```

Explanation:

- `BASE_URL`: backend URL.
- `API_KEY`: internal HTTP API key.
- `MQTT_BROKER`: same broker used by backend.

### 10.4 GPS Helper Functions

`haversine()`:

- Calculates distance between GPS points.

`min_dist()`:

- Finds distance from a point to nearest stand.

### 10.5 MQTT Helper

`mqtt_client()`:

- Creates MQTT client.
- Connects to broker.
- Starts background network loop.
- Returns `None` if MQTT fails.

### 10.6 Bike Send Functions

`send_bike_location()`:

- Sends bike location by MQTT if available.
- Falls back to `POST /bike/gps` if MQTT unavailable.

`send_bike_status()`:

- Sends bike battery/lock/online status by HTTP.

### 10.7 Stand Send Functions

`post_stand_status()`:

- Sends stand online/status to backend.

`post_stand_otp()`:

- Sends OTP to backend through internal HTTP route.

### 10.8 `cmd_stand(args)`

Purpose:

- Simulate a real stand keypad.

Behavior:

- Sends stand status `READY`.
- If `--brute-force`, sends three wrong OTPs.
- Otherwise sends the provided OTP or asks for OTP input.

### 10.9 `cmd_bike(args)`

Purpose:

- Simulate a real bike telemetry device.

Modes:

- `normal`: bike moves and returns near stand.
- `misbehave`: bike leaves campus and keeps pinging.
- `tamper`: parked bike moves away from stand.

Behavior:

- Sends bike status.
- Sends GPS points every few seconds.
- Uses random noise so the path looks realistic.

### 10.10 Argument Parser

Supported commands:

```bash
python3 simulator.py stand --stand 1 --code 123456
python3 simulator.py stand --stand 1 --brute-force
python3 simulator.py bike --bike 1 --mode normal
python3 simulator.py bike --bike 1 --mode misbehave
python3 simulator.py bike --bike 2 --mode tamper
```

## 11. Stand ESP Firmware Explanation

The intended full stand firmware is designed for:

- ESP board.
- 4x4 keypad.
- I2C LCD.
- Green LED.
- Red LED.
- Buzzer.
- MQTT communication.

Important note:

- The current local `esp32_stand/stand_keypad/stand_keypad.ino` may be a temporary buzzer test sketch.
- Restore the full stand firmware from git before using the real stand.

### 11.1 Firmware Includes

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
```

Explanation:

- `WiFi.h`: connects ESP to Wi-Fi.
- `PubSubClient.h`: MQTT client.
- `Keypad.h`: reads matrix keypad.
- `Wire.h`: I2C communication.
- `LiquidCrystal_I2C.h`: controls I2C LCD.

### 11.2 LCD Object

```cpp
LiquidCrystal_I2C lcd(0x27, 16, 2);
```

Explanation:

- LCD I2C address is `0x27`.
- LCD has 16 columns and 2 rows.
- If LCD does not work, some modules use address `0x3F`.

### 11.3 Wi-Fi And MQTT Constants

```cpp
const char* WIFI_SSID   = "YOUR_WIFI_SSID";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER = "broker.hivemq.com";
const int   MQTT_PORT   = 1883;
```

Explanation:

- Set Wi-Fi name and password before flashing.
- MQTT broker must match backend.
- Port `1883` is normal MQTT without TLS.

Important security note:

- Do not commit real Wi-Fi passwords to git.

### 11.4 Stand Identity

```cpp
const int   STAND_ID = 1;
const char* STAND_CODE = "STAND-001";
const char* STAND_TOPIC_ID = "1";
```

Explanation:

- `STAND_ID` must match backend database.
- `STAND_CODE` is a human-readable stand code.
- `STAND_TOPIC_ID` is used in MQTT topic names.

For stand 2:

```cpp
STAND_ID = 2
STAND_CODE = "STAND-002"
STAND_TOPIC_ID = "2"
```

### 11.5 Pins

Current board-specific pin map from latest git:

```text
Rows:    GPIO 4, 5, 18, 19
Columns: GPIO 20, 21, 22, 23
LCD SDA: GPIO 6
LCD SCL: GPIO 7
Green:   GPIO 2
Red:     GPIO 3
Buzzer:  GPIO 15
```

Important:

- This pin map is not for every generic ESP32 dev board.
- Use it only with the board that exposes these GPIOs.

### 11.6 Keypad Matrix

```cpp
char keys[ROWS][COLS] = {
  { '1', '2', '3', 'A' },
  { '4', '5', '6', 'B' },
  { '7', '8', '9', 'C' },
  { '*', '0', '#', 'D' }
};
```

Explanation:

- Defines the keypad layout.
- Digits are used for OTP.
- `*` clears OTP.
- `#` submits OTP.

### 11.7 MQTT Topics

The firmware builds:

```text
cbss/stand/1/otp
cbss/stand/1/result
cbss/stand/1/status
```

Explanation:

- OTP topic sends entered OTP to server.
- Result topic receives unlock/wrong/locked result from server.
- Status topic tells server that stand is online/ready.

### 11.8 `setup()`

Step-by-step:

1. Start serial monitor.
2. Configure LED and buzzer pins.
3. Start I2C using `Wire.begin(6, 7)`.
4. Initialize LCD.
5. Show splash screen.
6. Build MQTT topic strings.
7. Connect Wi-Fi.
8. Configure MQTT.
9. Connect MQTT.
10. Show OTP prompt.
11. Publish stand status `READY`.

### 11.9 `loop()`

Step-by-step:

1. Keep MQTT connected.
2. Process MQTT incoming messages.
3. Publish status every 30 seconds.
4. If waiting too long for server result, show timeout.
5. If waiting for server, ignore keypad input.
6. Read keypad key.
7. Debounce key.
8. If `*`, clear OTP.
9. If `#`, submit OTP only when 6 digits are entered.
10. If digit, append it to OTP buffer and update LCD.

### 11.10 `submitOtp()`

Builds JSON:

```json
{
  "standId": 1,
  "standCode": "STAND-001",
  "deviceId": "1",
  "otp": "123456"
}
```

Then publishes it to:

```text
cbss/stand/1/otp
```

### 11.11 `handleResultMessage()`

Reads backend result and reacts:

- `UNLOCKED`: show success, green LED, success sound.
- `WRONG`: show wrong OTP, red LED.
- `LOCKED`: show guard alert.
- `EXPIRED`: show expired message.
- `NO_BOOKING`: show no booking at this stand.
- Anything else: show server error.

After every result, it redraws the OTP prompt so the next user can enter a fresh OTP.

## 12. Bike Telemetry Firmware Status

The project includes a bike telemetry sketch in:

```text
esp32_bike/bike_tracker/bike_tracker.ino
```

Current practical note:

- GPS testing is being left aside for now.
- Use `simulator.py bike ...` for project testing and demo.

The intended bike firmware responsibilities are:

- Connect to Wi-Fi.
- Connect to MQTT.
- Read GPS coordinates.
- Publish bike location to `cbss/bike/{bikeId}/location`.
- Publish status to `cbss/bike/{bikeId}/status`.
- Listen for commands on `cbss/bike/{bikeId}/command`.

## 13. Main Workflow: Student Booking To Unlock

Full happy path:

1. Student logs in.
2. Frontend calls `/stands`.
3. Student selects a stand.
4. Frontend calls `/stands/:id/bikes`.
5. Student books available bike.
6. Frontend calls `POST /bookings`.
7. Backend creates OTP and booking.
8. Frontend displays OTP.
9. Student enters OTP at stand keypad.
10. Stand ESP publishes OTP to MQTT.
11. Backend receives OTP.
12. Backend checks OTP hash.
13. Backend marks booking `ACTIVE`.
14. Backend marks bike `IN_USE`.
15. Backend sends unlock command to bike.
16. Backend sends `UNLOCKED` result to stand.
17. Frontend polling detects booking is active.
18. Student rides bike.

Simple diagram:

```text
Frontend booking
  -> Backend creates OTP
  -> Student enters OTP on stand
  -> Stand sends MQTT OTP
  -> Backend verifies OTP
  -> Backend unlocks bike
  -> Frontend updates booking state
```

## 14. Main Workflow: Bike Tracking

Normal tracking path:

1. Bike simulator/device sends latitude and longitude.
2. Backend updates bike `last_lat` and `last_lng`.
3. Backend saves GPS history if booking is active/flagged.
4. Admin live map calls `/admin/live-bikes`.
5. Admin live map calls `/admin/bike-paths`.
6. Frontend updates marker and path line.

## 15. Main Workflow: Return Bike

Return path:

1. Student clicks `Return Bike`.
2. Frontend calls `POST /bookings/:id/return`.
3. Backend loads bike.
4. Backend checks if bike is within 30 meters of any stand.
5. If not near a stand, return is rejected.
6. If near a stand, booking becomes `COMPLETED`.
7. Bike becomes `AVAILABLE`.
8. Bike is assigned to the detected stand.
9. Backend sends lock command to bike.

Important:

- Current behavior allows return to any nearby stand.
- It does not force return to original stand.

## 16. Main Workflow: Alerts

OTP brute force:

- Three wrong OTP attempts make booking `FLAGGED`.
- Alert type: `OTP_BRUTE_FORCE`.

Tamper:

- If an available bike moves away from its stand, backend creates `TAMPER`.

Low battery:

- If battery drops below 20 percent, backend creates `LOW_BATTERY`.

Out of bounds:

- If bike leaves campus polygon, booking becomes `FLAGGED`.
- Bike becomes `MISSING`.
- Alert type: `OUT_OF_BOUNDS`.

Overdue:

- If ride passes return time, backend creates overdue alert.
- If too late, guard alert is created and user is banned.

## 17. Commands To Run The Project On Raspberry Pi

### 17.1 Pull Latest Code

```bash
cd ~/Desktop/cbss
git pull origin main
```

### 17.2 Install Backend Dependencies

```bash
cd ~/Desktop/cbss/backend
npm install
```

### 17.3 Start Backend

```bash
cd ~/Desktop/cbss/backend
node server.js
```

Expected output:

```text
CBSS running on http://localhost:3000
[MQTT] Connected - subscribed to stand and bike device topics
```

### 17.4 Open Frontend

On Raspberry Pi browser:

```text
http://localhost:3000
```

From another device on same Wi-Fi:

```text
http://<raspberry-pi-ip>:3000
```

Find Pi IP:

```bash
hostname -I
```

## 18. Commands To Set Up Simulator On Raspberry Pi

If Python packages are blocked by externally managed environment, use virtual environment.

```bash
cd ~/Desktop/cbss
python3 -m venv .venv
source .venv/bin/activate
pip install requests paho-mqtt
```

Every new terminal:

```bash
cd ~/Desktop/cbss
source .venv/bin/activate
```

If `venv` is missing:

```bash
sudo apt install python3-venv
```

## 19. Test Accounts

Admin:

```text
ADMIN001 / admin123
```

Students:

```text
STU001 / pass123
STU002 / pass123
```

## 20. Full Happy Path Test

Terminal 1: start backend.

```bash
cd ~/Desktop/cbss/backend
node server.js
```

Browser:

```text
http://localhost:3000
```

Steps:

1. Login as `STU001 / pass123`.
2. Open stand 1.
3. Book an available bike for 15 minutes.
4. Copy the OTP shown on screen.
5. In terminal 2, run stand simulator:

```bash
cd ~/Desktop/cbss
source .venv/bin/activate
python3 simulator.py stand --stand 1 --code <OTP>
```

Expected:

- Simulator shows `UNLOCKED`.
- Booking screen changes from OTP pending to active ride.

Then simulate bike ride:

```bash
python3 simulator.py bike --bike 1 --mode normal
```

Expected:

- Admin live map shows bike movement.
- Bike path appears.
- Bike can be returned when near stand.

Return:

1. Click `Return Bike` in frontend.
2. Expected result: booking becomes `COMPLETED`.
3. Bike becomes `AVAILABLE`.

## 21. Wrong OTP Test

Create a booking first.

Then run:

```bash
python3 simulator.py stand --stand 1 --code 111111
```

Expected:

- Result is `WRONG`.
- Booking remains pending until max attempts.

## 22. Brute Force Test

Create a booking first.

Then run:

```bash
python3 simulator.py stand --stand 1 --brute-force
```

Expected:

- After three wrong attempts, backend flags the booking.
- Admin alert appears.
- Stand result becomes `LOCKED`.

## 23. No Booking Test

When no pending booking exists at stand 1:

```bash
python3 simulator.py stand --stand 1 --code 123456
```

Expected:

```text
NO_BOOKING
```

## 24. Misbehave / Out-Of-Bounds Test

Create a booking and unlock it first.

Then run:

```bash
python3 simulator.py bike --bike 1 --mode misbehave
```

Expected:

- Bike leaves campus boundary.
- Booking becomes `FLAGGED`.
- Bike becomes `MISSING`.
- Admin alert appears.
- Live map should continue showing the bike location.

Stop simulator:

```bash
Ctrl+C
```

## 25. Tamper Test

Use a bike that is parked and available.

Example:

```bash
python3 simulator.py bike --bike 2 --mode tamper
```

Expected:

- Backend detects available bike moved away from its stand.
- Admin alert type `TAMPER` appears.

## 26. Low Battery Test

The simulator randomly decreases battery during bike pings.

Expected:

- If battery goes below 20 percent, backend creates `LOW_BATTERY` alert.

For a faster manual HTTP test:

```bash
curl -X POST http://localhost:3000/bike/gps \
  -H "Content-Type: application/json" \
  -H "x-api-key: cbss-internal-key-123" \
  -d '{"bikeId":1,"lat":26.8505,"lng":75.8000,"battery":10}'
```

## 27. Admin Testing Checklist

Login:

```text
ADMIN001 / admin123
```

Check:

- Alerts page loads.
- Resolve alert button works.
- Bookings page shows all bookings.
- Booking search works.
- Live Map shows active/flagged bikes.
- Bikes page shows status, stand, battery, GPS.
- Users page shows users.
- Unban button works if a user is banned.

## 28. Useful API Test Commands

### 28.1 Login

```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"collegeId":"STU001","password":"pass123"}'
```

### 28.2 Submit Stand OTP By HTTP

```bash
curl -X POST http://localhost:3000/stand/otp \
  -H "Content-Type: application/json" \
  -H "x-api-key: cbss-internal-key-123" \
  -d '{"standId":1,"otp":"123456"}'
```

### 28.3 Send Bike GPS By HTTP

```bash
curl -X POST http://localhost:3000/bike/gps \
  -H "Content-Type: application/json" \
  -H "x-api-key: cbss-internal-key-123" \
  -d '{"bikeId":1,"lat":26.8505,"lng":75.8000,"battery":85}'
```

### 28.4 Send Bike Status By HTTP

```bash
curl -X POST http://localhost:3000/bike/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: cbss-internal-key-123" \
  -d '{"bikeId":1,"lockState":"LOCKED","battery":90,"online":true}'
```

### 28.5 Send Stand Status By HTTP

```bash
curl -X POST http://localhost:3000/stand/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: cbss-internal-key-123" \
  -d '{"standId":1,"state":"READY","online":true}'
```

## 29. Development Check Commands

### 29.1 Backend Syntax Check

From repo root:

```bash
node --check backend/server.js
node --check backend/db.js
```

### 29.2 Simulator Syntax Check

```bash
python3 -m py_compile simulator.py
```

### 29.3 Git Status

```bash
git status
```

### 29.4 Push Changes

```bash
git add <files>
git commit -m "Your commit message"
git push origin main
```

### 29.5 Pull On Raspberry Pi

```bash
cd ~/Desktop/cbss
git pull origin main
```

## 30. Common Problems And Fixes

### 30.1 `Cannot find module 'express'`

Cause:

- Backend dependencies are not installed.

Fix:

```bash
cd ~/Desktop/cbss/backend
npm install
node server.js
```

### 30.2 `paho-mqtt not found`

Fix:

```bash
cd ~/Desktop/cbss
source .venv/bin/activate
pip install paho-mqtt requests
```

### 30.3 `externally managed environment`

Cause:

- Raspberry Pi OS blocks global pip install.

Fix:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install requests paho-mqtt
```

### 30.4 Frontend Cannot Load

Check backend is running:

```bash
cd ~/Desktop/cbss/backend
node server.js
```

Then open:

```text
http://localhost:3000
```

### 30.5 Live Map Shows No Bike

Possible reasons:

- Booking is not active or flagged.
- Bike has not sent GPS.
- Simulator is not running.
- Backend is not running.
- Admin is not logged in.

Fix:

```bash
python3 simulator.py bike --bike 1 --mode normal
```

### 30.6 Return Bike Fails

Cause:

- Bike is not near any stand.

Fix:

- Run `normal` simulator route until final waypoint.
- Then click Return Bike.

### 30.7 Bike Returns To Another Stand

This is expected in current logic.

Reason:

- Backend assigns bike to whichever stand it detects nearby during return.

### 30.8 Stand ESP Pin Issue

The stand firmware pin map is board-specific.

If using a normal ESP32-WROOM board, do not blindly use GPIO 6, 7, or 20. Use the correct board pinout.

## 31. What To Say In Viva

Short explanation:

```text
CBSS is an IoT-based campus bike sharing system. A student books a bike through the web app. The Raspberry Pi backend generates an OTP and stores it securely as a hash. The student enters the OTP at the stand keypad. The stand ESP sends the OTP to the backend using MQTT. If the OTP is valid, the backend changes the booking to active, marks the bike in use, and publishes an unlock command. Bike movement is monitored using GPS telemetry or simulator data, and the admin dashboard displays alerts and live tracking.
```

Architecture explanation:

```text
The system has four layers: device, communication, backend, and application. The device layer contains stand ESPs and bike telemetry units. The communication layer uses MQTT for IoT messages and HTTP for frontend APIs. The backend layer runs on Raspberry Pi using Node.js, Express, and SQLite. The application layer is the web dashboard for students and admins.
```

Current status explanation:

```text
The backend, frontend, booking flow, OTP verification, admin dashboard, simulator-based bike tracking, alert generation, and live map are implemented. Real bike GPS hardware and the full 12-sensor stack are under development, so the simulator is used for reliable testing and demonstration of telemetry behavior.
```

## 32. Best Final Demo Sequence

Use this sequence for a clean demo:

1. Start backend:

```bash
cd ~/Desktop/cbss/backend
node server.js
```

2. Open frontend:

```text
http://localhost:3000
```

3. Login as student:

```text
STU001 / pass123
```

4. Book bike from stand 1.

5. Copy OTP.

6. Simulate stand OTP:

```bash
cd ~/Desktop/cbss
source .venv/bin/activate
python3 simulator.py stand --stand 1 --code <OTP>
```

7. Simulate normal bike ride:

```bash
python3 simulator.py bike --bike 1 --mode normal
```

8. Login as admin:

```text
ADMIN001 / admin123
```

9. Open Live Map and show movement.

10. Return bike from student frontend.

11. Show booking completed and bike available again.

## 33. Current Limitations

- Real bike GPS hardware is not required for current testing because simulator covers the backend flow.
- Full 12-sensor stack is under work.
- Cloud integration such as ThingSpeak is under work.
- Stand firmware must be restored from full project code if the local file still contains only buzzer test code.
- Wi-Fi credentials should not be committed to git.

## 34. Quick One-Page Summary

CBSS lets students book campus bikes from a web app. The Raspberry Pi backend creates an OTP and stores it securely. The stand ESP sends keypad-entered OTPs to the backend over MQTT. If the OTP is correct, the backend activates the booking and unlocks the correct bike. Bike movement is tracked through simulator or GPS telemetry and displayed on the admin live map. The backend also detects wrong OTP attempts, tampering, geofence violations, low battery, and overdue returns.

Most important commands:

```bash
cd ~/Desktop/cbss/backend
npm install
node server.js
```

```bash
cd ~/Desktop/cbss
source .venv/bin/activate
python3 simulator.py stand --stand 1 --code <OTP>
python3 simulator.py bike --bike 1 --mode normal
python3 simulator.py bike --bike 1 --mode misbehave
python3 simulator.py bike --bike 2 --mode tamper
```

Frontend:

```text
http://localhost:3000
```

Accounts:

```text
ADMIN001 / admin123
STU001 / pass123
STU002 / pass123
```
