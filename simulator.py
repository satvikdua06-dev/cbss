#!/usr/bin/env python3
import argparse
import json
import math
import random
import sys
import time
import uuid

try:
    import requests
except ImportError:
    print("Missing dependency. Run: pip install requests paho-mqtt")
    sys.exit(1)

try:
    import paho.mqtt.client as mqtt_lib
    MQTT_AVAILABLE = True
except ImportError:
    print("paho-mqtt not found. Run: pip install paho-mqtt")
    print("Falling back to HTTP for GPS pings.")
    MQTT_AVAILABLE = False

BASE_URL  = "http://localhost:3000"
API_KEY   = "cbss-internal-key-123"
HEADERS   = {"Content-Type": "application/json", "x-api-key": API_KEY}

MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT   = 1883

STAND_COORDS = [
    (26.8505, 75.8000),
    (26.8515, 75.8010),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def haversine(lat1, lng1, lat2, lng2):
    R = 6371000
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = (math.sin(dLat/2)**2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dLng/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def min_dist(lat, lng):
    return min(haversine(lat, lng, s[0], s[1]) for s in STAND_COORDS)

# ── MQTT client ───────────────────────────────────────────────────────────────

_mqtt = None

def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        bike_id = userdata.get("bike_id")
        topic = f"cbss/bike/{bike_id}/command"
        client.subscribe(topic)
        print(f"  [MQTT] Connected — subscribed to {topic}")
    else:
        print(f"  [MQTT] Connection failed (rc={rc})")

def _on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode())
        cmd  = data.get("command", "?").upper()
        print(f"  [MQTT] << Command received: {cmd}")
    except Exception:
        pass

def setup_mqtt(bike_id):
    global _mqtt
    if not MQTT_AVAILABLE:
        return None
    client = mqtt_lib.Client(
        client_id=f"cbss-sim-{uuid.uuid4().hex[:8]}",
        userdata={"bike_id": bike_id},
    )
    client.on_connect = _on_connect
    client.on_message = _on_message
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_start()
        time.sleep(1.0)   # wait for on_connect
    except Exception as e:
        print(f"  [MQTT] Could not connect to broker: {e}")
        print("  Falling back to HTTP for GPS pings.")
        return None
    _mqtt = client
    return client

def send_gps(bike_id, lat, lng, battery, mqtt_client=None):
    if mqtt_client is not None:
        payload = json.dumps({"bikeId": bike_id, "lat": lat, "lng": lng, "battery": battery})
        mqtt_client.publish(f"cbss/bike/{bike_id}/gps", payload)
    else:
        try:
            r = requests.post(
                BASE_URL + "/bike/gps",
                json={"bikeId": bike_id, "lat": lat, "lng": lng, "battery": battery},
                headers=HEADERS, timeout=5,
            )
            if r.status_code != 200:
                print("  GPS ping failed: " + r.text)
        except Exception as e:
            print("  GPS error: " + str(e))
            sys.exit(1)

# ── OTP command ───────────────────────────────────────────────────────────────

def post_otp(bike_id, otp):
    try:
        r = requests.post(
            BASE_URL + "/stand/otp",
            json={"bikeId": bike_id, "otp": otp},
            headers=HEADERS, timeout=5,
        )
        return r.json()
    except Exception as e:
        print("  OTP error: " + str(e))
        sys.exit(1)

def cmd_otp(args):
    print("==================================================")
    print("  CBSS Stand Simulator - Bike #" + str(args.bike))
    print("==================================================")

    if args.brute_force:
        print("  [BRUTE FORCE] Trying 3 wrong OTPs...")
        for attempt in range(1, 4):
            wrong = str(random.randint(100000, 999999))
            print("  Attempt " + str(attempt) + "/3 - OTP: " + wrong)
            result = post_otp(args.bike, wrong)
            print("  -> " + str(result.get("result")) + ": " + str(result.get("message", "")))
            time.sleep(1)
        return

    code = args.code or input("  Enter OTP: ").strip()
    print("  Submitting OTP: " + code)
    result = post_otp(args.bike, code)
    print("  -> " + result.get("result", "ERROR") + ": " + result.get("message", result.get("error", "")))

# ── GPS command ───────────────────────────────────────────────────────────────

def cmd_gps(args):
    print("==================================================")
    print("  CBSS GPS Simulator - Bike #" + str(args.bike))
    print("  Mode: " + args.route)
    print("==================================================")

    mqtt_client = setup_mqtt(args.bike)
    transport   = "MQTT" if mqtt_client else "HTTP"
    print(f"  Transport: {transport}")
    print("")

    # Battery starts between 60-100 % and drains 1-3 % per ping
    battery = random.randint(60, 100)

    def ping(bike_id, lat, lng, index, total):
        nonlocal battery
        battery = max(0, battery - random.randint(1, 3))
        send_gps(bike_id, lat, lng, battery, mqtt_client)
        dist = round(min_dist(lat, lng))
        print(
            f"  Ping {index}/{total}"
            f"  lat={round(lat,5)}"
            f"  lng={round(lng,5)}"
            f"  dist={dist}m"
            f"  batt={battery}%"
        )

    if args.route == "normal":
        waypoints = [
            (26.8505, 75.8000),
            (26.8508, 75.8005),
            (26.8512, 75.8008),
            (26.8510, 75.8006),
            (26.8505, 75.8001),
            (26.8505, 75.8000),
        ]
        print("  Bike takes a campus loop and returns to the stand.")
        print("  5 s between pings. Ctrl+C to stop.")
        print("")
        for i, wp in enumerate(waypoints, 1):
            lat = wp[0] + random.uniform(-0.00002, 0.00002)
            lng = wp[1] + random.uniform(-0.00002, 0.00002)
            ping(args.bike, lat, lng, i, len(waypoints))
            if i < len(waypoints):
                time.sleep(5)
        print("")
        print("  Done. Bike is back at the stand.")

    elif args.route == "misbehave":
        waypoints = [
            (26.8505, 75.8000),
            (26.8490, 75.7980),   # leaves campus boundary here
            (26.8475, 75.7960),
            (26.8460, 75.7940),
            (26.8450, 75.7930),
        ]
        print("  Bike leaves campus — triggers geofence alert.")
        print("  5 s between pings. Ctrl+C to stop.")
        print("")
        for i, wp in enumerate(waypoints, 1):
            lat = wp[0] + random.uniform(-0.00005, 0.00005)
            lng = wp[1] + random.uniform(-0.00005, 0.00005)
            ping(args.bike, lat, lng, i, len(waypoints))
            if i < len(waypoints):
                time.sleep(5)

        print("")
        print("  Bike is away. Pinging every 10 s. Ctrl+C to stop.")
        print("")
        count = 0
        while True:
            count += 1
            lat = 26.8450 + random.uniform(-0.0001, 0.0001)
            lng = 75.7930 + random.uniform(-0.0001, 0.0001)
            ping(args.bike, lat, lng, count, "?")
            time.sleep(10)

    elif args.route == "tamper":
        print("  Simulates a parked bike (AVAILABLE) moving — triggers tamper alert.")
        print("  5 s between pings. Ctrl+C to stop.")
        print("")
        tamper_path = [
            (26.8505, 75.8000),
            (26.8507, 75.8003),
            (26.8510, 75.8007),   # > 20 m from stand
            (26.8514, 75.8012),
        ]
        for i, wp in enumerate(tamper_path, 1):
            lat = wp[0] + random.uniform(-0.00002, 0.00002)
            lng = wp[1] + random.uniform(-0.00002, 0.00002)
            ping(args.bike, lat, lng, i, len(tamper_path))
            if i < len(tamper_path):
                time.sleep(5)
        print("")
        print("  Done. Check admin alerts for TAMPER alert.")

    if mqtt_client:
        time.sleep(1)
        mqtt_client.loop_stop()
        mqtt_client.disconnect()

# ── Main ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(prog="simulator", description="CBSS Simulator")
sub = parser.add_subparsers(dest="cmd")
sub.required = True

p_otp = sub.add_parser("otp", help="Simulate OTP entry at a stand")
p_otp.add_argument("--bike", type=int, required=True, help="Bike ID")
p_otp.add_argument("--code", type=str, default=None, help="OTP code")
p_otp.add_argument("--brute-force", dest="brute_force", action="store_true")
p_otp.set_defaults(func=cmd_otp)

p_gps = sub.add_parser("gps", help="Simulate GPS pings from a bike")
p_gps.add_argument("--bike", type=int, required=True, help="Bike ID")
p_gps.add_argument(
    "--mode", dest="route",
    choices=["normal", "misbehave", "tamper"],
    default="normal",
)
p_gps.set_defaults(func=cmd_gps)

try:
    args = parser.parse_args()
    args.func(args)
except KeyboardInterrupt:
    print("\n  Stopped.")
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
