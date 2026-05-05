# CBSS - College Bike Sharing System

A college bike-sharing system with a Raspberry Pi server, one ESP32 on every stand, and one ESP32 on every bike.

## Architecture

- `Raspberry Pi`
  Runs the Node.js backend, booking logic, OTP verification, MQTT coordination, alerts, and SQLite database.
- `Stand ESP32`
  One per stand. Reads keypad OTPs, shows LCD feedback, and talks to the Pi over MQTT.
- `Bike ESP32`
  One per bike. Sends live location, battery, and lock status to the Pi over MQTT.

## MQTT topics

### Stand ESP -> Raspberry Pi

- `cbss/stand/{standId}/otp`
- `cbss/stand/{standId}/status`

### Raspberry Pi -> Stand ESP

- `cbss/stand/{standId}/result`

### Bike ESP -> Raspberry Pi

- `cbss/bike/{bikeId}/location`
- `cbss/bike/{bikeId}/status`

### Raspberry Pi -> Bike ESP

- `cbss/bike/{bikeId}/command`

## Device model

- `1 Raspberry Pi` is the central server.
- `1 ESP32 per stand` handles OTP entry and local feedback.
- `1 ESP32 per bike` handles GPS/live location and lock state.

The backend maps:

- `stand -> docked bikes`
- `booking -> bike`
- `bike -> bike ESP topic id`

So when a stand submits a correct OTP, the Raspberry Pi decides which bike at that stand should unlock and publishes the unlock command to that bike.

## Setup

### Backend

```bash
cd backend
npm install
node server.js
```

The backend runs on:

- [http://localhost:3000](http://localhost:3000)

## Seeded demo data

### Stands

- `STAND-001` -> topic id `1`
- `STAND-002` -> topic id `2`

### Bikes

- `BIKE-001` -> topic id `1`
- `BIKE-002` -> topic id `2`
- `BIKE-003` -> topic id `3`
- `BIKE-004` -> topic id `4`

### Accounts

- `ADMIN001 / admin123`
- `STU001 / pass123`
- `STU002 / pass123`

## Simulator

The simulator now matches the real hardware split:

### Simulate stand OTP entry

```bash
python simulator.py stand --stand 1 --code 123456
```

### Simulate stand brute force

```bash
python simulator.py stand --stand 1 --brute-force
```

### Simulate bike GPS/location

```bash
python simulator.py bike --bike 1 --mode normal
```

### Simulate bike leaving campus

```bash
python simulator.py bike --bike 1 --mode misbehave
```

### Simulate tamper on parked bike

```bash
python simulator.py bike --bike 1 --mode tamper
```

## Important routes

- `POST /bookings`
- `POST /stand/otp`
- `POST /stand/status`
- `POST /bike/gps`
- `POST /bike/status`
- `GET /system/topology`
- `GET /admin/devices`

## Notes

- OTPs are still returned in the booking API for demo/testing.
- The stand ESP code expects a 16x2 I2C LCD and a 4x4 keypad.
- A real bike ESP sketch is available at `esp32_bike/bike_tracker/bike_tracker.ino` for GPS-based telemetry.
- Update the bike sketch Wi-Fi credentials, bike identity, GPS UART pins, and optional battery pin before flashing.
