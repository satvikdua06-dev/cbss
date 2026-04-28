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
    print("Falling back to HTTP where possible.")
    MQTT_AVAILABLE = False

BASE_URL = "http://localhost:3000"
API_KEY = "cbss-internal-key-123"
HEADERS = {"Content-Type": "application/json", "x-api-key": API_KEY}

MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883

STAND_COORDS = [
    (26.8505, 75.8000),
    (26.8515, 75.8010),
]


def haversine(lat1, lng1, lat2, lng2):
    r = 6371000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def min_dist(lat, lng):
    return min(haversine(lat, lng, stand[0], stand[1]) for stand in STAND_COORDS)


def mqtt_client(client_id, userdata=None):
    if not MQTT_AVAILABLE:
      return None

    client = mqtt_lib.Client(client_id=client_id, userdata=userdata or {})
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_start()
        time.sleep(1.0)
        return client
    except Exception as exc:
        print(f"  [MQTT] Could not connect to broker: {exc}")
        return None


def send_bike_location(bike_id, lat, lng, battery, mqtt_conn=None):
    payload = {"bikeId": bike_id, "lat": lat, "lng": lng, "battery": battery}
    if mqtt_conn is not None:
        mqtt_conn.publish(f"cbss/bike/{bike_id}/location", json.dumps(payload))
        return

    response = requests.post(
        BASE_URL + "/bike/gps",
        json=payload,
        headers=HEADERS,
        timeout=5,
    )
    if response.status_code != 200:
        raise RuntimeError(response.text)


def send_bike_status(bike_id, lock_state=None, battery=None, online=True):
    payload = {"bikeId": bike_id, "online": online}
    if lock_state:
        payload["lockState"] = lock_state
    if battery is not None:
        payload["battery"] = battery

    response = requests.post(
        BASE_URL + "/bike/status",
        json=payload,
        headers=HEADERS,
        timeout=5,
    )
    return response.json()


def post_stand_status(stand_id, state, online=True):
    response = requests.post(
        BASE_URL + "/stand/status",
        json={"standId": stand_id, "state": state, "online": online},
        headers=HEADERS,
        timeout=5,
    )
    return response.json()


def post_stand_otp(stand_id, otp):
    response = requests.post(
        BASE_URL + "/stand/otp",
        json={"standId": stand_id, "otp": otp},
        headers=HEADERS,
        timeout=5,
    )
    return response.json()


def cmd_stand(args):
    print("==================================================")
    print(f"  CBSS Stand Simulator - Stand #{args.stand}")
    print("==================================================")

    post_stand_status(args.stand, "READY", True)

    if args.brute_force:
        print("  [BRUTE FORCE] Trying 3 wrong OTPs...")
        for attempt in range(1, 4):
            wrong = str(random.randint(100000, 999999))
            result = post_stand_otp(args.stand, wrong)
            print(f"  Attempt {attempt}/3 -> {result.get('result')}: {result.get('message', '')}")
            time.sleep(1)
        return

    code = args.code or input("  Enter OTP: ").strip()
    result = post_stand_otp(args.stand, code)
    print(f"  -> {result.get('result', 'ERROR')}: {result.get('message', result.get('error', ''))}")


def cmd_bike(args):
    print("==================================================")
    print(f"  CBSS Bike Simulator - Bike #{args.bike}")
    print(f"  Mode: {args.route}")
    print("==================================================")

    mqtt_conn = mqtt_client(
        client_id=f"cbss-bike-sim-{uuid.uuid4().hex[:8]}",
        userdata={"bike_id": args.bike},
    )
    print(f"  Transport: {'MQTT' if mqtt_conn else 'HTTP'}")

    battery = random.randint(60, 100)
    send_bike_status(args.bike, lock_state="LOCKED", battery=battery, online=True)

    def ping(lat, lng, index, total):
        nonlocal battery
        battery = max(0, battery - random.randint(1, 3))
        send_bike_location(args.bike, lat, lng, battery, mqtt_conn)
        dist = round(min_dist(lat, lng))
        print(
            f"  Ping {index}/{total}  lat={round(lat, 5)}  lng={round(lng, 5)}"
            f"  dist={dist}m  batt={battery}%"
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
    elif args.route == "misbehave":
        waypoints = [
            (26.8505, 75.8000),
            (26.8490, 75.7980),
            (26.8475, 75.7960),
            (26.8460, 75.7940),
            (26.8450, 75.7930),
        ]
    else:
        waypoints = [
            (26.8505, 75.8000),
            (26.8507, 75.8003),
            (26.8510, 75.8007),
            (26.8514, 75.8012),
        ]

    for index, waypoint in enumerate(waypoints, 1):
        lat = waypoint[0] + random.uniform(-0.00003, 0.00003)
        lng = waypoint[1] + random.uniform(-0.00003, 0.00003)
        ping(lat, lng, index, len(waypoints))
        if index < len(waypoints):
            time.sleep(5)

    if args.route == "misbehave":
        print("")
        print("  Bike is away. Pinging every 10 s. Ctrl+C to stop.")
        counter = 0
        while True:
            counter += 1
            lat = 26.8450 + random.uniform(-0.0001, 0.0001)
            lng = 75.7930 + random.uniform(-0.0001, 0.0001)
            ping(lat, lng, counter, "?")
            time.sleep(10)

    if mqtt_conn:
        time.sleep(1)
        mqtt_conn.loop_stop()
        mqtt_conn.disconnect()


parser = argparse.ArgumentParser(prog="simulator", description="CBSS Simulator")
sub = parser.add_subparsers(dest="cmd")
sub.required = True

stand_parser = sub.add_parser("stand", help="Simulate OTP entry at a stand")
stand_parser.add_argument("--stand", type=int, required=True, help="Stand ID")
stand_parser.add_argument("--code", type=str, default=None, help="OTP code")
stand_parser.add_argument("--brute-force", dest="brute_force", action="store_true")
stand_parser.set_defaults(func=cmd_stand)

bike_parser = sub.add_parser("bike", help="Simulate GPS pings from a bike ESP")
bike_parser.add_argument("--bike", type=int, required=True, help="Bike ID")
bike_parser.add_argument(
    "--mode",
    dest="route",
    choices=["normal", "misbehave", "tamper"],
    default="normal",
)
bike_parser.set_defaults(func=cmd_bike)

try:
    args = parser.parse_args()
    args.func(args)
except KeyboardInterrupt:
    print("\n  Stopped.")
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
