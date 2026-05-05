# CBSS Report Diagrams

This file contains report-ready diagrams for the Campus Bike Sharing System (CBSS).

---

## 1. Overall System Architecture

```mermaid
flowchart LR
    U["Student User"] --> FE["Web Frontend<br/>Booking / OTP / History"]
    A["Admin User"] --> FE2["Admin Dashboard<br/>Alerts / Live Map / Bikes / Users"]

    FE --> API["Raspberry Pi Backend<br/>Node.js + Express + SQLite + MQTT Client"]
    FE2 --> API

    API <--> DB["SQLite Database<br/>Users / Stands / Bikes / Bookings / Alerts / GPS History"]

    ST1["Stand ESP32<br/>Keypad + LCD + LEDs + Buzzer"] <--> MQTT["MQTT Broker"]
    BK1["Bike ESP32<br/>GPS + Telemetry + Lock Status"] <--> MQTT
    API <--> MQTT

    MQTT <--> API
```

---

## 2. Layered IoT Architecture

```mermaid
flowchart TD
    L1["Application Layer<br/>Student UI<br/>Admin Dashboard"] --> L2
    L2["Backend Layer<br/>Booking Logic<br/>OTP Validation<br/>Alerts<br/>Data Storage"] --> L3
    L3["Communication Layer<br/>HTTP / REST<br/>MQTT<br/>Wi-Fi"] --> L4
    L4["Device Layer<br/>Stand ESP32<br/>Bike ESP32<br/>Sensors / Actuators"]
```

---

## 3. Network Topology

```mermaid
flowchart TD
    PI["Raspberry Pi<br/>Central Server"] --- WIFI["Campus Wi-Fi Network"]
    WIFI --- S1["Stand ESP32 - Stand 1"]
    WIFI --- S2["Stand ESP32 - Stand 2"]
    WIFI --- S3["Stand ESP32 - Stand N"]
    WIFI --- B1["Bike ESP32 - Bike 1"]
    WIFI --- B2["Bike ESP32 - Bike 2"]
    WIFI --- BN["Bike ESP32 - Bike N"]
    WIFI --- WEB["Student/Admin Browser"]
```

---

## 4. Booking and OTP Unlock Flowchart

```mermaid
flowchart TD
    START["Student logs in"] --> STANDS["View available stands and bikes"]
    STANDS --> BOOK["Book a bike"]
    BOOK --> OTP["Backend generates OTP"]
    OTP --> SHOW["OTP shown on web app"]
    SHOW --> ENTER["Student enters OTP on stand keypad"]
    ENTER --> PUB["Stand ESP publishes OTP via MQTT"]
    PUB --> VERIFY["Backend verifies OTP"]
    VERIFY --> DECISION{"OTP valid?"}
    DECISION -- Yes --> UNLOCK["Backend marks booking ACTIVE<br/>and issues unlock command"]
    UNLOCK --> RESULT1["Stand shows success<br/>Bike unlocked"]
    DECISION -- No --> RESULT2["Stand shows failure<br/>Wrong / Locked / Expired"]
```

---

## 5. Real-Time Bike Tracking Flow

```mermaid
flowchart TD
    GPS["Bike ESP reads GPS / telemetry"] --> PUB["Publish location and status via MQTT"]
    PUB --> BACKEND["Raspberry Pi backend receives data"]
    BACKEND --> STORE["Store latest state and GPS history"]
    STORE --> CHECK["Check geofence / tamper / battery / overdue rules"]
    CHECK --> ALERT{"Any anomaly?"}
    ALERT -- Yes --> ADMIN["Create admin alert"]
    ALERT -- No --> MAP["Update live map state"]
    ADMIN --> UI["Admin dashboard"]
    MAP --> UI
```

---

## 6. Sequence Diagram for OTP Verification

```mermaid
sequenceDiagram
    participant Student
    participant Frontend
    participant Backend as Raspberry Pi Backend
    participant Stand as Stand ESP32
    participant Bike as Bike ESP32

    Student->>Frontend: Book bike
    Frontend->>Backend: POST /bookings
    Backend-->>Frontend: OTP + booking details
    Student->>Stand: Enter OTP on keypad
    Stand->>Backend: MQTT cbss/stand/{id}/otp
    Backend->>Backend: Validate OTP and booking
    alt OTP valid
        Backend->>Bike: MQTT unlock command
        Backend->>Stand: MQTT result = UNLOCKED
        Stand-->>Student: LCD/LED/buzzer success
    else OTP invalid
        Backend->>Stand: MQTT result = WRONG / LOCKED / EXPIRED
        Stand-->>Student: LCD/LED/buzzer failure
    end
```

---

## 7. Data Flow Diagram

```mermaid
flowchart LR
    User["Student / Admin"] --> Frontend["Web Interface"]
    Frontend --> Backend["Backend APIs"]
    Stand["Stand ESP32"] --> Backend
    Bike["Bike ESP32"] --> Backend
    Backend --> Database["Database"]
    Backend --> Alerts["Alerts Engine"]
    Alerts --> Frontend
    Database --> Frontend
```

---

## 8. Database Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ BOOKINGS : makes
    STANDS ||--o{ BIKES : contains
    STANDS ||--o{ BOOKINGS : pickup_point
    BIKES ||--o{ BOOKINGS : assigned_to
    BOOKINGS ||--o{ ALERTS : triggers
    BOOKINGS ||--o{ BIKE_GPS_HISTORY : records
    STANDS ||--o{ STAND_EVENTS : logs
    BIKES ||--o{ BIKE_EVENTS : logs

    USERS {
        int id
        string college_id
        string name
        string email
        int is_admin
        int is_banned
    }

    STANDS {
        int id
        string code
        string name
        float lat
        float lng
        string esp_topic_id
        int online
    }

    BIKES {
        int id
        string code
        string status
        int stand_id
        string esp_topic_id
        string lock_state
        float last_lat
        float last_lng
        int battery_level
        int online
    }

    BOOKINGS {
        int id
        int user_id
        int bike_id
        int stand_id
        string status
        string otp_hash
        int otp_attempts
        int otp_expires_at
        int return_by
    }
```

---

## 9. Stand Prototype Hardware Block Diagram

```mermaid
flowchart LR
    KP["4x4 Keypad"] --> ESP["ESP32 Stand Controller"]
    LCD["16x2 I2C LCD"] --> ESP
    LEDG["Green LED"] --> ESP
    LEDR["Red LED"] --> ESP
    BZ["Buzzer"] --> ESP
    ESP <--> WIFI["Wi-Fi / MQTT"]
    WIFI <--> PI["Raspberry Pi Backend"]
```

---

## 10. Planned Bike Hardware Block Diagram

```mermaid
flowchart LR
    GPS["GPS Module"] --> BESP["ESP32 Bike Controller"]
    IMU["IMU Sensor"] --> BESP
    BATT["Battery Voltage Sensor"] --> BESP
    WHEEL["Wheel / Motion Sensor"] --> BESP
    LOCK["Lock State / Actuator Interface"] --> BESP
    BESP <--> WIFI["Wi-Fi / MQTT"]
    WIFI <--> PI["Raspberry Pi Backend"]
```

---

## 11. Planned 12-Sensor / 12-Telemetry Stack

```mermaid
flowchart TD
    ROOT["Planned Bike Telemetry Stack"] --> GPS1["GPS Latitude"]
    ROOT --> GPS2["GPS Longitude"]
    ROOT --> GPS3["GPS Speed"]
    ROOT --> GPS4["GPS Altitude"]
    ROOT --> ACCX["Accelerometer X"]
    ROOT --> ACCY["Accelerometer Y"]
    ROOT --> ACCZ["Accelerometer Z"]
    ROOT --> GYRX["Gyroscope X"]
    ROOT --> GYRY["Gyroscope Y"]
    ROOT --> GYRZ["Gyroscope Z"]
    ROOT --> BATT["Battery Voltage"]
    ROOT --> WHEEL["Wheel Rotation"]
```

---

## 12. Project Status Chart

```mermaid
pie showData
    title CBSS Current Project Status
    "Implemented Core Backend + Frontend + Stand Flow" : 60
    "Testing and Validation Completed" : 15
    "Bike Firmware Under Work" : 10
    "12-Sensor Stack Under Work" : 10
    "Cloud Integration Under Work" : 5
```

---

## 13. Module Completion Graph

```mermaid
xychart-beta
    title "CBSS Module Completion Estimate"
    x-axis ["Backend", "Frontend", "Stand ESP", "Bike ESP", "Cloud", "12-Sensor Stack"]
    y-axis "Completion %" 0 --> 100
    bar [90, 85, 80, 25, 10, 20]
```

---

## 14. Testing Flowchart

```mermaid
flowchart TD
    T1["Start backend on Raspberry Pi"] --> T2["Open frontend and log in"]
    T2 --> T3["Book available bike"]
    T3 --> T4["Receive OTP"]
    T4 --> T5["Enter OTP on stand / simulator"]
    T5 --> T6{"Unlocked?"}
    T6 -- Yes --> T7["Send bike telemetry"]
    T7 --> T8["Observe live map and booking state"]
    T8 --> T9["Return bike near stand"]
    T9 --> T10["Verify completed booking"]
    T6 -- No --> T11["Check wrong OTP / expired / brute-force behavior"]
```

---

## 15. Alert Handling Flowchart

```mermaid
flowchart TD
    EVENT["Incoming bike/stand event"] --> RULES["Backend rule evaluation"]
    RULES --> TYPE{"Alert condition met?"}
    TYPE -- No --> END["No alert"]
    TYPE -- Yes --> CREATE["Create alert entry"]
    CREATE --> VIEW["Show in admin dashboard"]
    VIEW --> RESOLVE["Admin resolves alert"]
```

---

## 16. Suggested Figure List for the Report

You can cite the diagrams in the report as:

- Figure 1: Overall System Architecture
- Figure 2: Layered IoT Architecture
- Figure 3: Network Topology
- Figure 4: Booking and OTP Unlock Flowchart
- Figure 5: Real-Time Bike Tracking Flow
- Figure 6: OTP Verification Sequence Diagram
- Figure 7: Database ER Diagram
- Figure 8: Stand Hardware Block Diagram
- Figure 9: Planned Bike Hardware Block Diagram
- Figure 10: Planned 12-Sensor / 12-Telemetry Stack
- Figure 11: Project Status Chart
- Figure 12: Module Completion Graph
