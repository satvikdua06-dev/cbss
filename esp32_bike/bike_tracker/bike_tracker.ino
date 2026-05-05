/*
 * CBSS - Bike Telemetry Unit
 * Hardware : ESP8266 + NEO-6M GPS module
 *
 * Publishes real GPS and battery data to the Raspberry Pi backend
 * and listens for lock/unlock commands for the assigned bike.
 */

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>

const char* WIFI_SSID   = "Satvik";
const char* WIFI_PASS   = "ihhd80013";
const char* MQTT_BROKER = "broker.hivemq.com";
const int   MQTT_PORT   = 1883;

const int   BIKE_ID = 1;
const char* BIKE_CODE = "BIKE-001";
const char* BIKE_TOPIC_ID = "1";

// ESP8266 + NEO-6M wiring
// GPS TX -> D5
// GPS RX -> D6
const int GPS_RX_PIN = 14;
const int GPS_TX_PIN = 12;

const int GPS_BAUD   = 9600;

// Optional battery pin. Set to -1 if unused.
#define BATTERY_ADC_ENABLED 0

const int LOCK_STATUS_LED_PIN = LED_BUILTIN;

const unsigned long LOCATION_INTERVAL_MS = 5000;
const unsigned long STATUS_INTERVAL_MS   = 15000;
const unsigned long GPS_FIX_TIMEOUT_MS   = 20000;

char topicLocation[48];
char topicStatus[48];
char topicCommand[48];

bool lockIsEngaged = true;
unsigned long lastLocationPublish = 0;
unsigned long lastStatusPublish = 0;
unsigned long lastFixMillis = 0;

TinyGPSPlus gps;
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

void connectWifi();
void connectMqtt();
void onMqttMessage(char* topic, byte* payload, unsigned int length);
void publishLocation(bool includeFix);
void publishStatus(const char* state);
int readBatteryPercent();
void handleCommand(const String& msg);

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPS_BAUD);

  pinMode(LOCK_STATUS_LED_PIN, OUTPUT);
  digitalWrite(LOCK_STATUS_LED_PIN, HIGH);

  snprintf(topicLocation, sizeof(topicLocation), "cbss/bike/%s/location", BIKE_TOPIC_ID);
  snprintf(topicStatus, sizeof(topicStatus), "cbss/bike/%s/status", BIKE_TOPIC_ID);
  snprintf(topicCommand, sizeof(topicCommand), "cbss/bike/%s/command", BIKE_TOPIC_ID);

  connectWifi();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  connectMqtt();

  publishStatus("BOOTED");
  Serial.printf("[CBSS] Bike unit %s ready\n", BIKE_CODE);
}

void loop() {
  while (gpsSerial.available() > 0) {
    if (gps.encode(gpsSerial.read()) && gps.location.isUpdated()) {
      lastFixMillis = millis();
    }
  }

  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  unsigned long nowMs = millis();

  if (nowMs - lastLocationPublish >= LOCATION_INTERVAL_MS) {
    bool includeFix = gps.location.isValid() && (nowMs - lastFixMillis <= GPS_FIX_TIMEOUT_MS);
    publishLocation(includeFix);
  }

  if (nowMs - lastStatusPublish >= STATUS_INTERVAL_MS) {
    publishStatus("ONLINE");
  }
}

void connectWifi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.printf("\n[WiFi] Connected - IP: %s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  char clientId[64];
  snprintf(clientId, sizeof(clientId), "cbss-bike-%s-%04x", BIKE_TOPIC_ID, (unsigned)random(0xFFFF));

  while (!mqtt.connected()) {
    Serial.printf("[MQTT] Connecting as %s ...", clientId);
    if (mqtt.connect(clientId)) {
      mqtt.subscribe(topicCommand);
      Serial.printf(" connected, listening on %s\n", topicCommand);
      publishStatus("ONLINE");
    } else {
      Serial.printf(" failed (state=%d), retrying in 3 s\n", mqtt.state());
      delay(3000);
    }
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[<<] %s : %s\n", topic, msg.c_str());

  if (String(topic) == topicCommand) {
    handleCommand(msg);
  }
}

void handleCommand(const String& msg) {
  if (msg.indexOf("\"unlock\"") != -1 || msg.indexOf("\"UNLOCK\"") != -1) {
    lockIsEngaged = false;
    digitalWrite(LOCK_STATUS_LED_PIN, LOW);
    Serial.println("[LOCK] Unlock command received");
    publishStatus("UNLOCKED");
    return;
  }

  if (msg.indexOf("\"lock\"") != -1 || msg.indexOf("\"LOCK\"") != -1) {
    lockIsEngaged = true;
    digitalWrite(LOCK_STATUS_LED_PIN, HIGH);
    Serial.println("[LOCK] Lock command received");
    publishStatus("LOCKED");
  }
}

void publishLocation(bool includeFix) {
  char payload[256];
  int battery = readBatteryPercent();

  if (includeFix) {
    snprintf(
      payload,
      sizeof(payload),
      "{\"bikeId\":%d,\"bikeCode\":\"%s\",\"lat\":%.6f,\"lng\":%.6f,\"battery\":%d}",
      BIKE_ID,
      BIKE_CODE,
      gps.location.lat(),
      gps.location.lng(),
      battery
    );
    mqtt.publish(topicLocation, payload);
    Serial.printf("[>>] Location published: %s\n", payload);
  } else {
    Serial.println("[GPS] No valid fix yet, skipping location publish");
  }

  lastLocationPublish = millis();
}

void publishStatus(const char* state) {
  char payload[192];
  int battery = readBatteryPercent();

  snprintf(
    payload,
    sizeof(payload),
    "{\"bikeId\":%d,\"bikeCode\":\"%s\",\"online\":true,\"battery\":%d,\"lockState\":\"%s\",\"state\":\"%s\"}",
    BIKE_ID,
    BIKE_CODE,
    battery,
    lockIsEngaged ? "LOCKED" : "UNLOCKED",
    state
  );

  mqtt.publish(topicStatus, payload);
  lastStatusPublish = millis();
  Serial.printf("[>>] Status published: %s\n", payload);
}

int readBatteryPercent() {
#if BATTERY_ADC_ENABLED
  int raw = analogRead(A0);
  int percent = map(raw, 500, 1024, 0, 100);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return percent;
#else
  return 100;
#endif
}
