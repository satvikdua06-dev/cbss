# CBSS Guideline Draft

This draft helps align the current CBSS project with the IoT project guidelines.

## 1. Report Draft

### Title

Campus Bike Sharing System (CBSS): An IoT-Based Smart Bicycle Booking, Unlocking, and Tracking Platform for Institute Campuses

### 1. Introduction

The increasing need for short-distance mobility inside large academic campuses creates demand for a bicycle-sharing platform that is secure, easy to use, and trackable in real time. Manual cycle issue systems often suffer from poor monitoring, inefficient record keeping, unauthorized access, and difficulty in locating bikes after misuse or delayed return.

This project proposes the College Bike Sharing System (CBSS), an end-to-end IoT-based solution for institute campuses. The system uses a Raspberry Pi as the central server, ESP32-based stand controllers for OTP-based unlocking, and ESP32-based bike devices for live location and status reporting. A web application is used for booking, administration, monitoring, and alerts.

The project addresses four main objectives:

- enable students to book bikes digitally
- secure bike pickup using OTP-based stand verification
- track bike movement and misuse conditions in real time
- provide administrative monitoring, alerts, and booking records

### 2. Problem Statement

Institute campuses often require a lightweight and low-cost transport system for movement between academic blocks, libraries, hostels, and gates. Traditional manual bike sharing is difficult to manage because:

- bikes may be taken without proper authorization
- return times are hard to enforce
- administrators lack real-time visibility into bike status and location
- stolen, misplaced, or misused bikes are hard to detect quickly

The problem is to design a deployable smart bike-sharing system for campus use that combines hardware devices, wireless communication, centralized logic, and a user-facing application.

### 3. Objectives

- build a campus-oriented bike booking and allocation platform
- automate stand-side OTP verification
- support live location tracking of bikes
- detect misuse cases such as wrong OTP attempts, tampering, overdue returns, and out-of-bounds movement
- provide an admin interface for monitoring and alerts

### 4. Literature Survey

You should add 2-3 related works here. A usable structure is:

- Smart bicycle sharing systems using GPS and GSM/Wi-Fi tracking
- IoT-enabled asset tracking systems with MQTT dashboards
- Smart access control systems using OTP or digital authentication

For each paper/project, include:

- what problem it solves
- what hardware and communication protocol it uses
- what limitations remain
- how CBSS differs

Suggested comparison angle:

- many systems focus only on tracking, while CBSS combines booking, unlock flow, alerts, and monitoring
- many systems use only app-based unlock, while CBSS supports stand-side OTP entry

### 5. Requirement Analysis

#### Functional Requirements

- user registration and login
- bike booking from a selected stand
- OTP generation for booked bike pickup
- OTP entry at stand keypad
- bike unlock command after successful verification
- live location updates from bike device
- return validation near a stand
- admin alert generation for misuse conditions
- booking history and live bike monitoring

#### Non-Functional Requirements

- low-latency OTP verification
- reliable wireless communication
- scalable design for multiple stands and bikes
- low-power bike-side hardware where possible
- maintainable and modular backend

### 6. System Architecture

#### Current Architecture Summary

- Raspberry Pi hosts the backend server and database
- stand ESP32 reads keypad input, drives LCD/LED/buzzer, and communicates through MQTT
- bike ESP32 is intended to publish location and device status through MQTT
- web frontend provides booking and admin dashboard

#### End-to-End Flow

1. Student logs into web app and books a bike.
2. Backend creates OTP and marks the bike as booked.
3. Student enters OTP on the stand keypad.
4. Stand ESP publishes OTP to the Raspberry Pi backend using MQTT.
5. Backend validates OTP and publishes unlock result.
6. Bike device receives unlock command and transitions to ride state.
7. Bike sends periodic location and status updates.
8. Admin dashboard displays bookings, alerts, and live map data.

#### Protocols

- MQTT for device communication
- HTTP/REST for web frontend and API calls
- SQLite for local persistence

### 7. Hardware Design

#### Current Prototype Hardware

- Raspberry Pi
- ESP32 stand controller
- 4x4 keypad
- 16x2 I2C LCD
- status LEDs
- buzzer

#### Suggested Bike-Side Hardware

- ESP32
- GPS module
- IMU / accelerometer
- wheel rotation sensor
- battery voltage sensing circuit
- lock actuator or relay/servo prototype

#### Prototype Explanation

The stand-side ESP32 is responsible for local user interaction at the docking point. It collects OTP input, displays instructions and feedback on the LCD, and communicates with the Raspberry Pi backend via MQTT. The Raspberry Pi performs the booking and OTP validation logic and can issue unlock or lock commands to bike devices.

### 8. Network and Connectivity

- Wi-Fi is used as the connectivity medium
- Raspberry Pi works as the central backend server
- MQTT broker is used for real-time publish/subscribe communication
- topic hierarchy is divided by stand ID and bike ID

Example topics:

- `cbss/stand/{standId}/otp`
- `cbss/stand/{standId}/result`
- `cbss/bike/{bikeId}/location`
- `cbss/bike/{bikeId}/command`

### 9. Software Implementation

#### Device-Side

- stand firmware handles keypad scanning, LCD output, OTP publish, and result handling
- bike-side software is planned for location and status reporting

#### Backend

- booking management
- OTP generation and validation
- stand and bike topic handling
- alert creation
- GPS storage and geofence checks
- overdue and tamper detection

#### Frontend

- student login and booking interface
- OTP display
- return flow
- admin panel with alerts, bikes, users, and live map

### 10. Cloud Integration

This is currently the largest gap relative to the guidelines.

Current state:

- no ThingSpeak or equivalent cloud platform is integrated yet

To make the report compliant, add:

- ThingSpeak channel for bike telemetry
- fields for latitude, longitude, battery, speed/ride status, tamper flag, and stand occupancy
- optional analytics or alert summary visualization

### 11. Application / Dashboard

Current application features:

- booking UI
- OTP display
- student booking history
- admin alerts
- admin bookings
- live bike map
- bike inventory and user listing

### 12. Results

You can present results using:

- OTP booking success screenshots
- admin live map screenshots
- alert screenshots for brute-force, tamper, overdue, and out-of-bounds cases
- MQTT topic logs from backend/serial monitor

Recommended result categories:

- successful booking and unlock
- wrong OTP rejection
- brute-force lockout
- location tracking
- tamper alert
- geofence alert

### 13. Testing and Validation

Suggested test cases:

- valid booking and OTP unlock
- wrong OTP attempt
- OTP expiry
- stand with no pending booking
- bike return near stand
- bike return away from stand
- live GPS update flow
- out-of-bounds ride detection
- parked-bike tamper detection
- low battery alert

### 14. Conclusion

CBSS demonstrates a practical end-to-end IoT solution for campus bike sharing. It integrates stand-side access control, centralized booking logic, real-time communication, tracking, and administrative monitoring. The current implementation provides a strong working prototype for a campus deployment scenario, though cloud integration and full bike-side firmware remain to be completed for full guideline compliance.

### 15. Future Scope

- integrate ThingSpeak or another cloud platform
- add full bike ESP firmware and real GPS hardware
- improve security using encrypted topics and secure provisioning
- add predictive maintenance and usage analytics
- expand to many stands and bikes with centralized fleet management

## 2. Practical Plan for the 12-Sensor Requirement

The current project does not meet the guideline's "minimum 12 sensors" requirement as-is. The cleanest way to satisfy it is to define a full production design with a rich bike-side sensor stack, while only prototyping a subset if needed.

### Recommended Sensor/Signal Plan

Count the following as the sensing set for the complete system:

1. GPS latitude
2. GPS longitude
3. GPS speed
4. GPS altitude
5. Accelerometer X
6. Accelerometer Y
7. Accelerometer Z
8. Gyroscope X
9. Gyroscope Y
10. Gyroscope Z
11. Battery voltage sensor
12. Wheel rotation / reed switch sensor

This gives you a clear 12-signal sensing model tied directly to the bike use case.

### Better Hardware Mapping

You can describe it like this:

- `NEO-6M or similar GPS module`
  Provides latitude, longitude, speed, altitude
- `MPU6050 / MPU9250 / similar IMU`
  Provides accelerometer and gyroscope axes
- `Battery voltage divider sensor`
  Monitors bike power health
- `Wheel rotation sensor`
  Detects motion and can estimate wheel speed

### If Faculty Demands 12 Distinct Physical Sensors

If your evaluator interprets "12 sensors" strictly as separate physical sensing elements, your current design is not enough. In that case, the realistic extension is:

- GPS module
- accelerometer
- gyroscope
- magnetometer
- battery voltage sensor
- wheel rotation sensor
- vibration sensor
- tilt sensor
- rain sensor
- ambient light sensor
- temperature sensor
- proximity / docking sensor

That reaches 12 functional sensing inputs more conservatively.

### Best Submission Strategy

For the report and viva, present:

- `prototype subset`: stand ESP + backend + frontend + simulated bike telemetry
- `full deployment design`: stand ESP + bike ESP + 12-sensor bike telemetry + cloud dashboard

This is the most realistic way to stay honest while still aligning with the rubric.

### Suggested Report Wording

You can write:

"The implemented prototype focuses on the most critical functional path: booking, OTP-based access control, backend coordination, and live telemetry handling. For full-scale deployment, the bike unit is designed around a multi-sensor telemetry stack consisting of GPS, IMU, battery monitoring, and wheel-motion sensing, providing at least 12 sensing parameters required for continuous monitoring, misuse detection, and fleet analytics."

## 3. Current Compliance Summary

### Strong Areas

- real campus problem
- end-to-end system thinking
- MQTT-based device communication
- backend plus UI implementation
- stand-side embedded prototype

### Weak Areas

- no cloud integration yet
- 12-sensor requirement not yet implemented in hardware
- bike firmware missing from repo
- formal report artifacts still need to be prepared

## 4. Immediate Next Steps

1. Add ThingSpeak integration to the backend.
2. Add a bike firmware file or at least a well-defined bike telemetry prototype.
3. Create an architecture diagram and hardware block diagram.
4. Convert this draft into your final report format.
