# Campus Bike Sharing System (CBSS)

## IoT Project Report

### Department of Communication and Computer Engineering
### Embedded Systems and Internet of Things Lab [CCE-222]
### The LNM Institute of Information Technology, Jaipur

---

## 1. Introduction

Large academic campuses require a simple, low-cost, and reliable mobility solution for short-distance travel between hostels, classrooms, libraries, labs, and campus gates. Bicycles are a practical answer, but manual bicycle issue systems are difficult to manage because they depend heavily on human supervision, paper records, and trust-based returns. This often leads to poor visibility of available bikes, unauthorized use, delayed returns, and difficulty in locating a missing bike.

The Campus Bike Sharing System (CBSS) is proposed as an Internet of Things (IoT) based solution for smart bicycle booking, controlled pickup, and live monitoring inside the institute campus. The system integrates a Raspberry Pi backend server, stand-side ESP32 controllers, and bike-side ESP32 telemetry devices. It also includes a web application for students and administrators.

The main purpose of the project is to build a practical end-to-end IoT system that connects embedded devices, network communication, backend logic, and a user-facing interface into one deployable campus solution.

---

## 2. Problem Statement

The institute campus needs a smart and manageable bicycle sharing mechanism that can:

- allow students to book bicycles digitally
- prevent unauthorized bike access
- track bike movement and device state
- detect misuse such as brute-force attempts, out-of-bounds rides, and delayed return
- provide administrators with centralized visibility and alerts

The problem is to design and develop a secure, connected, and monitorable bicycle-sharing system for campus deployment using IoT technologies.

---

## 3. Objectives

The objectives of the project are:

- to create a digital bicycle booking system for campus users
- to implement OTP-based stand-side bike access control
- to enable real-time bike tracking and status reporting
- to generate alerts for tampering, overdue returns, and abnormal movement
- to provide a web-based dashboard for students and administrators
- to design the system in a scalable way for multiple stands and multiple bikes

---

## 4. Literature Survey

Smart mobility and IoT-based asset tracking systems have been studied widely in recent years. Bicycle-sharing systems in smart campuses and smart cities usually focus on digital booking, GPS tracking, or dock automation. However, many low-cost implementations emphasize either software or tracking alone and do not fully integrate user authentication, stand-side control, and live monitoring.

A first class of related systems uses GPS and GSM or Wi-Fi to track vehicle position and report movement to a central server. These systems are effective for location awareness but often do not include secure physical access control at pickup points.

A second class of systems uses RFID cards, QR code scanning, or app-based unlocking. These approaches improve access control, but they may require every user to have a compatible phone or a separate card-based infrastructure.

A third class of systems focuses on IoT fleet monitoring using MQTT dashboards and cloud platforms. These systems are strong in telemetry and remote monitoring, but they may not address the user booking and campus-return workflow in a complete manner.

CBSS differs by combining:

- web-based booking
- OTP-based stand verification
- backend-controlled unlock logic
- bike-side location telemetry
- admin alert generation

This makes the project closer to a complete campus deployment pipeline rather than a single-feature prototype.

---

## 5. Requirement Analysis

### 5.1 Functional Requirements

The system should:

- allow user registration and login
- show available stands and bikes
- let a user book a bike for a selected duration
- generate an OTP for bike pickup
- accept OTP input through a stand-side keypad
- verify OTP at the backend
- unlock the assigned bike after successful verification
- accept bike location and status updates
- allow bike return near a valid stand
- store booking records and alert history
- provide admin monitoring and live map view

### 5.2 Non-Functional Requirements

The system should satisfy:

- low latency during OTP verification
- reasonable scalability for multiple stands and bikes
- reliable wireless communication
- maintainability of code and device logic
- practical deployability on a campus environment

### 5.3 Constraints

- low-cost hardware is preferred
- wireless connectivity may vary by location
- prototype hardware is limited compared to a full campus deployment
- some advanced telemetry and cloud features are still under development

---

## 6. System Architecture

CBSS is designed as a complete end-to-end IoT system with four major layers:

- device layer
- communication layer
- backend/data layer
- application layer

### 6.1 Device Layer

The current architecture includes:

- one Raspberry Pi acting as the central server
- one ESP32 at each stand for keypad/LCD-based user interaction
- one ESP32 planned for each bike for live location and status updates

The stand ESP handles:

- keypad input
- LCD prompts
- buzzer and LED feedback
- MQTT communication with the backend

The bike ESP design is intended to handle:

- location telemetry
- lock state reporting
- battery or health status reporting
- future multi-sensor ride monitoring

### 6.2 Communication Layer

The system uses:

- Wi-Fi connectivity
- MQTT for device-to-server communication
- HTTP/REST for frontend-to-backend communication

MQTT topics are organized by stand and bike identity. Example topics include:

- `cbss/stand/{standId}/otp`
- `cbss/stand/{standId}/result`
- `cbss/stand/{standId}/status`
- `cbss/bike/{bikeId}/location`
- `cbss/bike/{bikeId}/status`
- `cbss/bike/{bikeId}/command`

### 6.3 Backend Layer

The Raspberry Pi backend is implemented using:

- Node.js
- Express
- SQLite
- MQTT client integration

The backend manages:

- booking logic
- OTP generation and validation
- stand status
- bike state transitions
- GPS and event history
- tamper, overdue, and out-of-bounds alerts

### 6.4 Application Layer

The application layer is a web-based frontend that supports:

- user login and registration
- bike booking
- OTP display
- booking history
- admin monitoring
- live map of active bikes

---

## 7. Hardware Design

### 7.1 Current Prototype Hardware

The currently implemented prototype uses:

- Raspberry Pi as backend server
- ESP32 stand controller
- 4x4 keypad
- 16x2 I2C LCD
- two LEDs for status indication
- buzzer for audible feedback

### 7.2 Stand Prototype Working

The stand controller accepts OTP input from the keypad and displays status information on the LCD. It publishes the entered OTP to the backend through MQTT. The backend validates the OTP and returns the result. The stand then indicates success or failure through LEDs, buzzer, and LCD text.

### 7.3 Planned Bike Hardware

The full bike unit is being designed to include:

- ESP32 controller
- GPS module
- battery sensing circuit
- wheel/motion sensing
- IMU-based movement sensing
- lock state interface or actuator control

This part is under work and is not yet fully implemented in the present repository.

---

## 8. Network and Connectivity

The network design follows a star-like architecture centered on the Raspberry Pi backend.

- stand ESPs publish and subscribe through MQTT
- bike ESPs publish telemetry and receive commands
- the Raspberry Pi acts as the decision-making backend
- web clients interact using HTTP APIs

This approach is appropriate because:

- MQTT is lightweight for embedded communication
- the Raspberry Pi can coordinate multiple stands and bikes
- the frontend remains independent from low-level device logic

---

## 9. Software Implementation

### 9.1 Device-Side Software

The current device-side implementation available in the project is the stand firmware. It includes:

- keypad scanning
- OTP input buffering
- LCD feedback
- result handling
- periodic status publishing

The stand code is implemented in:

- `esp32_stand/stand_keypad/stand_keypad.ino`

Bike-side firmware is planned but still under development.

### 9.2 Backend Software

The backend implements:

- authentication
- stand and bike data management
- OTP validation
- booking and return workflow
- MQTT message handling
- GPS history storage
- alert generation

Important backend files:

- `backend/server.js`
- `backend/db.js`

### 9.3 Frontend Software

The frontend includes:

- student booking page
- OTP display page
- booking history
- admin panel
- live map and alerts

Important frontend files:

- `frontend/index.html`
- `frontend/app.js`
- `frontend/style.css`

---

## 10. Cloud Integration

According to the project guidelines, cloud integration such as ThingSpeak is mandatory. At the current stage, this part is not fully implemented.

### 10.1 Current Status

Current implementation uses:

- local backend on Raspberry Pi
- local database using SQLite
- MQTT communication between devices and server

### 10.2 Work Under Progress

Cloud integration is under work. The planned extension is:

- send bike telemetry to ThingSpeak or equivalent cloud platform
- visualize location-linked parameters, battery level, and alert states
- use cloud charts and dashboard views for analytics

This means the current prototype demonstrates local end-to-end IoT operation, while full cloud connectivity is still to be completed.

---

## 11. Application / Dashboard

The web application already provides a functional user interface.

### Student Features

- login/register
- view bike stands
- book a bike
- view OTP
- track active booking state
- return bike
- view booking history

### Admin Features

- alerts panel
- bookings list
- bike inventory
- user list
- live map for active bikes

This satisfies the application development part of the guidelines at the prototype level.

---

## 12. Results and Current Status

### 12.1 Current Working Features

At the time of writing, the following parts are working in the codebase:

- user login and registration
- stand listing and bike booking
- OTP generation
- OTP verification flow via stand-side MQTT
- backend-controlled unlock decision
- booking state management
- alert generation for wrong OTP, brute-force attempts, tamper, overdue return, and out-of-bounds conditions
- live bike path and admin monitoring through the frontend

### 12.2 Prototype Status Summary

The project currently demonstrates a strong partial end-to-end prototype:

- stand-side embedded access control is implemented
- backend coordination is implemented
- frontend dashboard is implemented
- simulated bike telemetry is supported

However, the following major components are still under progress:

- full bike ESP firmware
- cloud integration
- full 12-sensor hardware realization

### 12.3 Observed Strengths

- modular architecture
- practical campus relevance
- clear MQTT-based device communication
- usable frontend and admin controls
- scalable multi-stand and multi-bike logic in backend

### 12.4 Current Limitations

- bike hardware is not fully implemented in the repository
- cloud platform integration is missing
- the system uses simulation for some bike-side behaviors
- the complete sensor stack required by the final guideline is still under work

---

## 13. 12-Sensor Requirement Status

The project guideline specifies a minimum 12-sensor requirement. The current prototype does not yet fully satisfy this in deployed hardware form.

### 13.1 Honest Current Status

At present:

- stand-side prototype is implemented
- bike-side sensing stack is not fully built in hardware
- telemetry logic exists conceptually and partially through simulation

Therefore, the 12-sensor requirement should be reported as **under development** rather than fully completed.

### 13.2 Planned 12-Sensor / 12-Telemetry Stack

The planned bike-side sensing design is based on the following twelve sensing parameters:

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
11. Battery voltage
12. Wheel rotation / motion sensor

This sensing stack is chosen because it directly supports:

- live tracking
- ride-state monitoring
- fall/tamper detection
- battery health monitoring
- analytics for usage and movement behavior

### 13.3 Current Reporting Position

For submission and viva, the correct statement is:

- the present system implements the core booking and stand-side control workflow
- the complete 12-sensor bike telemetry subsystem is under work
- the architecture is already designed to incorporate the additional bike-side sensor streams

This is the most accurate and defensible way to present the project.

---

## 14. Testing and Validation

The project can be tested using both real backend/frontend flow and simulator-assisted device behavior.

### 14.1 Test Cases

- user registration and login
- successful booking
- correct OTP unlock
- wrong OTP attempt
- OTP expiry
- brute-force lockout after repeated wrong OTPs
- bike return near stand
- bike return away from stand
- simulated bike telemetry
- out-of-bounds alert
- tamper alert

### 14.2 Validation Outcome

The current system validates:

- end-to-end booking workflow
- stand-side access control logic
- backend alert and monitoring logic
- dashboard visualization of status and live movement

The remaining validation work is mainly for:

- real bike hardware
- cloud upload and dashboard verification
- full sensor integration

---

## 15. Conclusion

The Campus Bike Sharing System (CBSS) is a practical and relevant IoT solution for a real campus problem. The current implementation successfully demonstrates important elements of an end-to-end IoT system, including embedded stand-side interaction, network communication using MQTT, backend logic on Raspberry Pi, local data management, and a web-based dashboard.

The project is currently in a strong prototype stage. It already shows meaningful functionality and system integration. At the same time, it is important to state clearly that cloud integration and the full 12-sensor bike-side subsystem are still under work and have not yet been fully realized in hardware.

Even in its current form, CBSS represents a strong foundation for a deployable campus bike-sharing platform.

---

## 16. Future Scope

The following improvements are planned:

- integrate ThingSpeak or equivalent cloud platform
- implement complete bike-side ESP firmware
- add full multi-sensor telemetry support
- improve security using better credential and device provisioning practices
- add analytics such as demand forecasting and maintenance prediction
- scale to larger campus-wide deployments with many stands and bikes

---

## 17. Current Implementation Files

The major files in the current implementation are:

- `backend/server.js`
- `backend/db.js`
- `frontend/index.html`
- `frontend/app.js`
- `frontend/style.css`
- `esp32_stand/stand_keypad/stand_keypad.ino`
- `simulator.py`

---

## 18. Suggested Viva Statement

"Our project is a campus bike-sharing system built as an end-to-end IoT prototype. Currently, the Raspberry Pi backend, stand-side ESP32 controller, booking UI, OTP unlock flow, and telemetry-aware backend logic are implemented and working. The bike-side 12-sensor telemetry subsystem and cloud integration are part of the ongoing work, and the present architecture has already been designed to support those additions."
