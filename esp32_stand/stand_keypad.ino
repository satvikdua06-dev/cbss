/*
 * CBSS — Bike Stand Controller
 * Hardware : ESP32 dev board
 * Keypad   : 4×4 matrix (Rows → GPIO 13,12,14,27 | Cols → GPIO 26,25,33,32)
 * Green LED: GPIO 2  (via 220 Ω resistor to GND)
 * Red LED  : GPIO 4  (via 220 Ω resistor to GND)
 * Buzzer   : GPIO 5  (active piezo, or passive via tone())
 *
 * Libraries (install via Arduino Library Manager):
 *   - Keypad      by Mark Stanley & Alexander Brevig
 *   - PubSubClient by Nick O'Leary
 *
 * Flow:
 *   1. User enters 6-digit OTP on keypad
 *   2. Press # to submit, * to clear
 *   3. ESP publishes  cbss/stand/{STAND_ID}/otp    → {standId, otp}
 *   4. Backend publishes cbss/stand/{STAND_ID}/result → {result, message}
 *   5. Green LED + high beep  = UNLOCKED
 *      Red LED  + low beep   = WRONG / LOCKED / EXPIRED
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Keypad.h>

// ── Configuration ─────────────────────────────────────────────────────────────

const char*  WIFI_SSID    = "YOUR_WIFI_SSID";
const char*  WIFI_PASS    = "YOUR_WIFI_PASSWORD";
const char*  MQTT_BROKER  = "broker.hivemq.com";
const int    MQTT_PORT    = 1883;
const int    STAND_ID     = 1;    // ← change this per physical stand

// ── Pin definitions ───────────────────────────────────────────────────────────

const int PIN_LED_GREEN = 2;
const int PIN_LED_RED   = 4;
const int PIN_BUZZER    = 5;

// ── Keypad layout ─────────────────────────────────────────────────────────────

const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  { '1','2','3','A' },
  { '4','5','6','B' },
  { '7','8','9','C' },
  { '*','0','#','D' }
};
byte rowPins[ROWS] = { 13, 12, 14, 27 };
byte colPins[COLS]  = { 26, 25, 33, 32 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ── MQTT topics ───────────────────────────────────────────────────────────────

char topicOtp[40];     // cbss/stand/{id}/otp
char topicResult[40];  // cbss/stand/{id}/result
char topicCommand[40]; // cbss/bike/+/command  (lock confirmation — optional)

// ── State ─────────────────────────────────────────────────────────────────────

String       otpBuffer  = "";
bool         waiting    = false;   // true while awaiting backend response
unsigned long waitStart = 0;
const int    WAIT_TIMEOUT_MS = 8000;

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

// ── Setup ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_BUZZER,    OUTPUT);

  // Build topic strings
  sprintf(topicOtp,    "cbss/stand/%d/otp",    STAND_ID);
  sprintf(topicResult, "cbss/stand/%d/result",  STAND_ID);

  connectWifi();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  connectMqtt();

  indicateReady();
  Serial.printf("\n[CBSS] Stand #%d ready. Enter 6-digit OTP then press #\n\n", STAND_ID);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  // Timeout waiting for backend response
  if (waiting && millis() - waitStart > WAIT_TIMEOUT_MS) {
    waiting = false;
    Serial.println("[!] No response from server. Try again.");
    flashLed(PIN_LED_RED, 3);
  }

  // Ignore keypad input while waiting for server
  if (waiting) return;

  char key = keypad.getKey();
  if (!key) return;

  if (key == '*') {
    otpBuffer = "";
    Serial.println("[*] Cleared");
    beep(80);
    return;
  }

  if (key == '#') {
    if (otpBuffer.length() == 6) {
      submitOtp();
    } else {
      Serial.printf("[#] Need 6 digits, have %d\n", otpBuffer.length());
      flashLed(PIN_LED_RED, 2);
    }
    return;
  }

  // Accept only digit keys
  if (key >= '0' && key <= '9' && otpBuffer.length() < 6) {
    otpBuffer += key;
    beep(50);

    // Print masked buffer
    String masked = "";
    for (unsigned int i = 0; i < otpBuffer.length(); i++) masked += "*";
    Serial.printf("  [%s] (%d/6)\n", masked.c_str(), otpBuffer.length());

    if (otpBuffer.length() == 6) {
      Serial.println("  Press # to confirm or * to clear");
    }
  }
}

// ── OTP submission ────────────────────────────────────────────────────────────

void submitOtp() {
  char payload[64];
  snprintf(payload, sizeof(payload),
           "{\"standId\":%d,\"otp\":\"%s\"}", STAND_ID, otpBuffer.c_str());

  mqtt.publish(topicOtp, payload);
  Serial.printf("[>>] OTP submitted to %s\n", topicOtp);

  otpBuffer  = "";
  waiting    = true;
  waitStart  = millis();
}

// ── MQTT response handler ─────────────────────────────────────────────────────

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[<<] %s : %s\n", topic, msg.c_str());

  waiting = false;

  // Parse result field from JSON (simple string search — no JSON library needed)
  if (msg.indexOf("\"UNLOCKED\"") != -1) {
    Serial.println("  ✓ BIKE UNLOCKED");
    flashLed(PIN_LED_GREEN, 3);
    tone(PIN_BUZZER, 1200, 400);
    delay(500);

  } else if (msg.indexOf("\"WRONG\"") != -1) {
    Serial.println("  ✗ WRONG OTP");
    flashLed(PIN_LED_RED, 2);
    tone(PIN_BUZZER, 400, 300);
    delay(400);

  } else if (msg.indexOf("\"LOCKED\"") != -1) {
    Serial.println("  ✗ LOCKED — too many attempts, guard alerted");
    flashLed(PIN_LED_RED, 5);
    tone(PIN_BUZZER, 300, 800);
    delay(900);

  } else if (msg.indexOf("\"EXPIRED\"") != -1) {
    Serial.println("  ✗ OTP EXPIRED — make a new booking");
    flashLed(PIN_LED_RED, 3);
    tone(PIN_BUZZER, 350, 500);
    delay(600);

  } else if (msg.indexOf("\"NO_BOOKING\"") != -1) {
    Serial.println("  ✗ No active booking at this stand");
    flashLed(PIN_LED_RED, 2);
    tone(PIN_BUZZER, 400, 200);
    delay(300);
  }

  Serial.printf("\n[CBSS] Stand #%d ready. Enter OTP:\n\n", STAND_ID);
}

// ── WiFi ──────────────────────────────────────────────────────────────────────

void connectWifi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── MQTT ─────────────────────────────────────────────────────────────────────

void connectMqtt() {
  char clientId[40];
  snprintf(clientId, sizeof(clientId), "cbss-stand-%d-%04x", STAND_ID, (unsigned)random(0xFFFF));

  while (!mqtt.connected()) {
    Serial.printf("[MQTT] Connecting as %s ...", clientId);
    if (mqtt.connect(clientId)) {
      mqtt.subscribe(topicResult);
      Serial.printf(" connected, listening on %s\n", topicResult);
    } else {
      Serial.printf(" failed (state=%d), retrying in 3 s\n", mqtt.state());
      delay(3000);
    }
  }
}

// ── Feedback helpers ──────────────────────────────────────────────────────────

void flashLed(int pin, int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH);
    delay(180);
    digitalWrite(pin, LOW);
    delay(180);
  }
}

void beep(int ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

// Double green flash + short beep on boot
void indicateReady() {
  flashLed(PIN_LED_GREEN, 2);
  tone(PIN_BUZZER, 1000, 150);
  delay(200);
}
