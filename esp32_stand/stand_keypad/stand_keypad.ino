/*
 * CBSS - Bike Stand Controller
 * Hardware : ESP32 dev board
 * Stand ESP : one ESP32 per stand
 * Keypad   : 4x4 matrix (Rows -> GPIO 4,5,18,19 | Cols -> GPIO 20,21,22,23)
 * LCD I2C  : SDA -> GPIO 6, SCL -> GPIO 7
 * Green LED: GPIO 2  (via 220 ohm resistor to GND)
 * Red LED  : GPIO 3  (via 220 ohm resistor to GND)
 * Buzzer   : GPIO 15 (active piezo, or passive via tone())
 *
 * MQTT topic model:
 *   Stand -> server:
 *     cbss/stand/{STAND_TOPIC_ID}/otp
 *     cbss/stand/{STAND_TOPIC_ID}/status
 *   Server -> stand:
 *     cbss/stand/{STAND_TOPIC_ID}/result
 *
 * The Raspberry Pi backend decides which bike at this stand is unlocked.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

const char* WIFI_SSID   = "Satvik";
const char* WIFI_PASS   = "ihhd80013";
const char* MQTT_BROKER = "broker.hivemq.com";
const int   MQTT_PORT   = 1883;

const int   STAND_ID = 1;
const char* STAND_CODE = "STAND-001";
const char* STAND_TOPIC_ID = "1";

const int PIN_LED_GREEN = 2;
const int PIN_LED_RED   = 3;
const int PIN_BUZZER    = 15;

const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  { '1', '2', '3', 'A' },
  { '4', '5', '6', 'B' },
  { '7', '8', '9', 'C' },
  { '*', '0', '#', 'D' }
};
byte rowPins[ROWS] = { 4, 5, 18, 19 };
byte colPins[COLS] = { 20, 21, 22, 23 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

char topicOtp[48];
char topicResult[48];
char topicStatus[48];

String otpBuffer = "";
bool waiting = false;
unsigned long waitStart = 0;
const unsigned long WAIT_TIMEOUT_MS = 8000;

unsigned long lastKeyTime = 0;
const unsigned long KEY_DEBOUNCE_MS = 50;
unsigned long lastStatusPublish = 0;
const unsigned long STATUS_INTERVAL_MS = 30000;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

void showOtpPrompt();
void showSplash();
void connectWifi();
void connectMqtt();
void submitOtp();
void onMqttMessage(char* topic, byte* payload, unsigned int length);
void handleResultMessage(const String& msg);
void publishStatus(const char* state);
void flashLed(int pin, int times);
void beep(int ms);
void indicateReady();

void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  Wire.begin(6, 7);
  lcd.init();
  lcd.backlight();
  showSplash();

  snprintf(topicOtp, sizeof(topicOtp), "cbss/stand/%s/otp", STAND_TOPIC_ID);
  snprintf(topicResult, sizeof(topicResult), "cbss/stand/%s/result", STAND_TOPIC_ID);
  snprintf(topicStatus, sizeof(topicStatus), "cbss/stand/%s/status", STAND_TOPIC_ID);

  connectWifi();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  connectMqtt();

  showOtpPrompt();
  indicateReady();
  publishStatus("READY");
  Serial.printf("\n[CBSS] Stand #%d ready. Enter 6-digit OTP then press #\n\n", STAND_ID);
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  if (millis() - lastStatusPublish > STATUS_INTERVAL_MS) {
    publishStatus(waiting ? "WAITING_RESULT" : "READY");
  }

  if (waiting && millis() - waitStart > WAIT_TIMEOUT_MS) {
    waiting = false;
    Serial.println("[!] No response from server. Try again.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Server timeout");
    lcd.setCursor(0, 1);
    lcd.print("Try again");
    flashLed(PIN_LED_RED, 3);
    delay(1500);
    showOtpPrompt();
  }

  if (waiting) return;

  char key = keypad.getKey();
  if (!key) return;

  unsigned long nowMs = millis();
  if (nowMs - lastKeyTime < KEY_DEBOUNCE_MS) return;
  lastKeyTime = nowMs;

  Serial.print("[KEY] ");
  Serial.println(key);

  if (key == '*') {
    otpBuffer = "";
    beep(80);
    showOtpPrompt();
    return;
  }

  if (key == '#') {
    if (otpBuffer.length() == 6) {
      submitOtp();
    } else {
      Serial.printf("[#] Need 6 digits, have %d\n", otpBuffer.length());
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Need 6 digits");
      lcd.setCursor(0, 1);
      lcd.print("Press * to clear");
      flashLed(PIN_LED_RED, 2);
      delay(1200);
      showOtpPrompt();
    }
    return;
  }

  if (key >= '0' && key <= '9' && otpBuffer.length() < 6) {
    otpBuffer += key;
    beep(50);

    lcd.setCursor(0, 1);
    for (int i = 0; i < 6; i++) {
      lcd.print(i < otpBuffer.length() ? "*" : "_");
    }

    if (otpBuffer.length() == 6) {
      Serial.println("  Press # to confirm or * to clear");
    }
  }
}

void showSplash() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("CBSS ");
  lcd.print(STAND_CODE);
  lcd.setCursor(0, 1);
  lcd.print("Booting...");
  delay(1500);
}

void showOtpPrompt() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Stand ");
  lcd.print(STAND_ID);
  lcd.print(" Enter OTP");
  lcd.setCursor(0, 1);
  lcd.print("______");
}

void connectWifi() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.printf("\n[WiFi] Connected - IP: %s\n", WiFi.localIP().toString().c_str());
  lcd.setCursor(0, 1);
  lcd.print("WiFi connected");
  delay(1000);
}

void connectMqtt() {
  char clientId[64];
  snprintf(clientId, sizeof(clientId), "cbss-stand-%s-%04x", STAND_TOPIC_ID, (unsigned)random(0xFFFF));

  while (!mqtt.connected()) {
    Serial.printf("[MQTT] Connecting as %s ...", clientId);
    if (mqtt.connect(clientId)) {
      mqtt.subscribe(topicResult);
      Serial.printf(" connected, listening on %s\n", topicResult);
      publishStatus("READY");
    } else {
      Serial.printf(" failed (state=%d), retrying in 3 s\n", mqtt.state());
      delay(3000);
    }
  }
}

void submitOtp() {
  char payload[160];
  snprintf(
    payload,
    sizeof(payload),
    "{\"standId\":%d,\"standCode\":\"%s\",\"deviceId\":\"%s\",\"otp\":\"%s\"}",
    STAND_ID,
    STAND_CODE,
    STAND_TOPIC_ID,
    otpBuffer.c_str()
  );

  mqtt.publish(topicOtp, payload);
  Serial.printf("[>>] OTP submitted to %s\n", topicOtp);

  waiting = true;
  waitStart = millis();
  otpBuffer = "";

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Checking OTP...");
  lcd.setCursor(0, 1);
  lcd.print("Please wait");
  publishStatus("WAITING_RESULT");
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[<<] %s : %s\n", topic, msg.c_str());

  if (String(topic) == topicResult) {
    handleResultMessage(msg);
  }
}

void handleResultMessage(const String& msg) {
  waiting = false;

  lcd.clear();

  if (msg.indexOf("\"UNLOCKED\"") != -1) {
    lcd.setCursor(0, 0);
    lcd.print("Bike unlocked");
    lcd.setCursor(0, 1);
    lcd.print("Ride safe");
    flashLed(PIN_LED_GREEN, 3);
    tone(PIN_BUZZER, 1200, 400);
    delay(500);
  } else if (msg.indexOf("\"WRONG\"") != -1) {
    lcd.setCursor(0, 0);
    lcd.print("Wrong OTP");
    lcd.setCursor(0, 1);
    lcd.print("Try again");
    flashLed(PIN_LED_RED, 2);
    tone(PIN_BUZZER, 400, 300);
    delay(400);
  } else if (msg.indexOf("\"LOCKED\"") != -1) {
    lcd.setCursor(0, 0);
    lcd.print("Stand locked");
    lcd.setCursor(0, 1);
    lcd.print("Guard alerted");
    flashLed(PIN_LED_RED, 5);
    tone(PIN_BUZZER, 300, 800);
    delay(900);
  } else if (msg.indexOf("\"EXPIRED\"") != -1) {
    lcd.setCursor(0, 0);
    lcd.print("OTP expired");
    lcd.setCursor(0, 1);
    lcd.print("Book again");
    flashLed(PIN_LED_RED, 3);
    tone(PIN_BUZZER, 350, 500);
    delay(600);
  } else if (msg.indexOf("\"NO_BOOKING\"") != -1) {
    lcd.setCursor(0, 0);
    lcd.print("No booking");
    lcd.setCursor(0, 1);
    lcd.print("At this stand");
    flashLed(PIN_LED_RED, 2);
    tone(PIN_BUZZER, 400, 200);
    delay(300);
  } else {
    lcd.setCursor(0, 0);
    lcd.print("Server error");
    lcd.setCursor(0, 1);
    lcd.print("Try again");
    flashLed(PIN_LED_RED, 2);
    tone(PIN_BUZZER, 250, 300);
    delay(400);
  }

  delay(2500);
  showOtpPrompt();
  publishStatus("READY");
}

void publishStatus(const char* state) {
  char payload[160];
  snprintf(
    payload,
    sizeof(payload),
    "{\"standId\":%d,\"standCode\":\"%s\",\"online\":true,\"state\":\"%s\"}",
    STAND_ID,
    STAND_CODE,
    state
  );
  mqtt.publish(topicStatus, payload);
  lastStatusPublish = millis();
}

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

void indicateReady() {
  flashLed(PIN_LED_GREEN, 2);
  tone(PIN_BUZZER, 1000, 150);
  delay(200);
}
