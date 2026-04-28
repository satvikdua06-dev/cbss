const API = "http://localhost:3000";
let token = localStorage.getItem("token");
let currentUser = null;
let selectedBikeId = null;
let activeBookingId = null;
let otpCountdownTimer = null;
let returnCountdownTimer = null;
let pollTimer = null;
let leafletMap = null;
let bikeMarkers = [];
let standMarkers = [];
let bikePolylines = {};
let allBookings = [];
let mapRefreshTimer = null;

// ── Init ──────────────────────────────────────────────────────────────────────

window.onload = async () => {
  if (token) {
    try {
      const me = await apiFetch("/me");
      currentUser = me;
      showLoggedIn();
    } catch {
      logout();
    }
  }
};

function showLoggedIn() {
  if (currentUser.is_admin) {
    document.getElementById("navbar-admin").style.display = "flex";
    showPage("admin");
    showAdminTab("alerts");
  } else {
    document.getElementById("navbar-student").style.display = "flex";
    document.getElementById("navName").textContent =
      currentUser.name.split(" ")[0];
    showPage("home");
  }
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ── Page routing ──────────────────────────────────────────────────────────────

function showPage(page) {
  ["auth", "home", "booking", "history", "admin"].forEach((p) => {
    document.getElementById("page-" + p).style.display = "none";
  });
  document.getElementById("page-" + page).style.display = "block";
  if (page === "home") loadHome();
  if (page === "history") loadHistory();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.getElementById("formLogin").style.display =
    tab === "login" ? "block" : "none";
  document.getElementById("formRegister").style.display =
    tab === "register" ? "block" : "none";
  document
    .getElementById("tabLogin")
    .classList.toggle("active", tab === "login");
  document
    .getElementById("tabRegister")
    .classList.toggle("active", tab === "register");
  document.getElementById("authError").textContent = "";
}

async function login() {
  const collegeId = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPass").value;
  try {
    const data = await apiFetch("/login", {
      method: "POST",
      body: JSON.stringify({ collegeId, password }),
    });
    token = data.token;
    localStorage.setItem("token", token);
    currentUser = { name: data.name, is_admin: data.is_admin };
    document.getElementById("authError").textContent = "";
    showLoggedIn();
  } catch (e) {
    document.getElementById("authError").textContent = e.message;
  }
}

async function register() {
  const collegeId = document.getElementById("regId").value.trim();
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPass").value;
  try {
    await apiFetch("/register", {
      method: "POST",
      body: JSON.stringify({ collegeId, name, email, password }),
    });
    document.getElementById("authError").style.color = "#2d9144";
    document.getElementById("authError").textContent =
      "Registered! Please log in.";
    switchTab("login");
    document.getElementById("loginId").value = collegeId;
  } catch (e) {
    document.getElementById("authError").style.color = "#d32f2f";
    document.getElementById("authError").textContent = e.message;
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem("token");
  clearInterval(mapRefreshTimer);
  if (leafletMap) {
    Object.values(bikePolylines).forEach((p) => leafletMap.removeLayer(p));
    bikePolylines = {};
  }
  document.getElementById("navbar-student").style.display = "none";
  document.getElementById("navbar-admin").style.display = "none";
  ["auth", "home", "booking", "history", "admin"].forEach((p) => {
    document.getElementById("page-" + p).style.display = "none";
  });
  document.getElementById("page-auth").style.display = "block";
}

// ── Home ──────────────────────────────────────────────────────────────────────

async function loadHome() {
  try {
    const bookings = await apiFetch("/bookings/mine");
    const active = bookings.find(
      (b) => b.status === "PENDING_OTP" || b.status === "ACTIVE",
    );
    if (active) {
      activeBookingId = active.id;
      document.getElementById("activeBanner").style.display = "flex";
      document.getElementById("bannerBike").textContent = active.bike_code;
      document.getElementById("bannerTime").textContent = formatTime(
        active.return_by,
      );
    } else {
      activeBookingId = null;
      document.getElementById("activeBanner").style.display = "none";
    }
  } catch {}

  try {
    const stands = await apiFetch("/stands");
    document.getElementById("standsList").innerHTML = stands
      .map(
        (s) => `
      <div class="stand-card" onclick="openStand(${s.id}, '${esc(s.name)}')">
        <h3>&#128205; ${esc(s.name)}</h3>
        <div class="${s.available_bikes > 0 ? "stand-avail" : "stand-avail stand-zero"}">${s.available_bikes}</div>
        <div class="stand-avail-label">bike${s.available_bikes !== 1 ? "s" : ""} available</div>
        <div class="stand-meta">
          ${s.booked_bikes ? `${s.booked_bikes} booked` : "No bikes on hold"} &bull; ${s.online ? "Stand online" : "Stand offline"}
        </div>
      </div>
    `,
      )
      .join("");
  } catch (e) {
    document.getElementById("standsList").innerHTML =
      '<p class="error-msg">' + e.message + "</p>";
  }
}

async function openStand(standId, standName) {
  document.getElementById("modalStandName").textContent = standName;
  document.getElementById("standModal").style.display = "flex";
  document.getElementById("modalBikesList").innerHTML =
    '<p style="color:#888">Loading...</p>';
  try {
    const bikes = await apiFetch("/stands/" + standId + "/bikes");
    if (!bikes.length) {
      document.getElementById("modalBikesList").innerHTML =
        '<p class="empty-msg">No bikes are currently docked at this stand.</p>';
      return;
    }
    document.getElementById("modalBikesList").innerHTML = bikes
      .map(
        (b) => {
          const isAvailable = b.status === "AVAILABLE";
          const statusLabel = formatBikeStatus(b);
          return `
      <div class="bike-row ${isAvailable ? "" : "bike-row-disabled"}">
        <div>
          <div class="bike-code">${esc(b.code)}</div>
          <div class="bike-status">${statusLabel} &nbsp;${batteryHtml(b.battery_level)}</div>
        </div>
        <button
          class="btn-small ${isAvailable ? "" : "btn-disabled"}"
          ${isAvailable ? `onclick="openBookModal(${b.id},'${esc(b.code)}')"` : "disabled"}
        >
          ${isAvailable ? "Book" : "Unavailable"}
        </button>
      </div>
    `;
        },
      )
      .join("");
  } catch (e) {
    document.getElementById("modalBikesList").innerHTML =
      '<p class="error-msg">' + e.message + "</p>";
  }
}

function closeModal(e) {
  if (e.target.id === "standModal")
    document.getElementById("standModal").style.display = "none";
}
function closeBookModal(e) {
  if (e.target.id === "bookModal")
    document.getElementById("bookModal").style.display = "none";
}

function openBookModal(bikeId, bikeCode) {
  selectedBikeId = bikeId;
  document.getElementById("bookBikeCode").textContent = bikeCode;
  document.getElementById("bookError").textContent = "";
  document.getElementById("standModal").style.display = "none";
  document.getElementById("bookModal").style.display = "flex";
}

async function confirmBooking() {
  const returnMinutes = parseInt(
    document.getElementById("returnMinutes").value,
  );
  document.getElementById("bookError").textContent = "";
  try {
    const data = await apiFetch("/bookings", {
      method: "POST",
      body: JSON.stringify({ bikeId: selectedBikeId, returnMinutes }),
    });
    document.getElementById("bookModal").style.display = "none";
    showBookingPage(data);
  } catch (e) {
    document.getElementById("bookError").textContent = e.message;
  }
}

// ── Booking / OTP ─────────────────────────────────────────────────────────────

function showBookingPage(data) {
  activeBookingId = data.bookingId;
  document.getElementById("bookingPending").style.display = "block";
  document.getElementById("bookingActive").style.display = "none";
  document.getElementById("bookingDone").style.display = "none";
  document.getElementById("bookingMsg").textContent = "";
  document.getElementById("otpDisplay").textContent = data.otp;
  document.getElementById("otpBike").textContent = data.bikeCode;

  clearInterval(otpCountdownTimer);
  let seconds = 600;
  const tick = () => {
    const m = Math.floor(seconds / 60),
      s = seconds % 60;
    document.getElementById("otpCountdown").textContent =
      m + ":" + String(s).padStart(2, "0");
    if (seconds <= 0) clearInterval(otpCountdownTimer);
    seconds--;
  };
  tick();
  otpCountdownTimer = setInterval(tick, 1000);

  showPage("booking");
  pollBookingStatus();
}

async function goToActiveBooking() {
  if (!activeBookingId) return;
  try {
    const b = await apiFetch("/bookings/" + activeBookingId);
    showPage("booking");
    renderBookingState(b);
  } catch (e) {
    alert(e.message);
  }
}

function pollBookingStatus() {
  clearInterval(pollTimer);
  if (!activeBookingId) return;
  pollTimer = setInterval(async () => {
    try {
      const b = await apiFetch("/bookings/" + activeBookingId);
      renderBookingState(b);
      if (["COMPLETED", "FLAGGED", "EXPIRED"].includes(b.status))
        clearInterval(pollTimer);
    } catch {}
  }, 3000);
}

function renderBookingState(b) {
  if (b.status === "PENDING_OTP") return;
  clearInterval(otpCountdownTimer);
  if (b.status === "ACTIVE") {
    document.getElementById("bookingPending").style.display = "none";
    document.getElementById("bookingActive").style.display = "block";
    document.getElementById("activeReturnTime").textContent = formatTime(
      b.return_by,
    );
    startReturnCountdown(b.return_by);
  } else if (b.status === "COMPLETED") {
    document.getElementById("bookingPending").style.display = "none";
    document.getElementById("bookingActive").style.display = "none";
    document.getElementById("bookingDone").style.display = "block";
    clearInterval(returnCountdownTimer);
  } else if (b.status === "FLAGGED") {
    document.getElementById("bookingPending").style.display = "none";
    document.getElementById("bookingMsg").textContent =
      "Booking flagged after too many wrong OTP attempts.";
  } else if (b.status === "EXPIRED") {
    document.getElementById("bookingPending").style.display = "none";
    document.getElementById("bookingMsg").textContent =
      "OTP expired. Please make a new booking.";
  }
}

function startReturnCountdown(returnBy) {
  clearInterval(returnCountdownTimer);
  const tick = () => {
    const diff = returnBy - Math.floor(Date.now() / 1000);
    const el = document.getElementById("activeCountdown");
    if (diff <= 0) {
      el.textContent = "OVERDUE";
      el.style.color = "#b71c1c";
      return;
    }
    el.textContent =
      Math.floor(diff / 60) + ":" + String(diff % 60).padStart(2, "0");
  };
  tick();
  returnCountdownTimer = setInterval(tick, 1000);
}

async function returnBike() {
  document.getElementById("bookingMsg").textContent = "";
  try {
    await apiFetch("/bookings/" + activeBookingId + "/return", {
      method: "POST",
    });
    clearInterval(returnCountdownTimer);
    clearInterval(pollTimer);
    document.getElementById("bookingActive").style.display = "none";
    document.getElementById("bookingDone").style.display = "block";
  } catch (e) {
    document.getElementById("bookingMsg").textContent = e.message;
  }
}

// ── Student History ───────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const bookings = await apiFetch("/bookings/mine");
    if (!bookings.length) {
      document.getElementById("historyTable").innerHTML =
        '<p class="empty-msg">No bookings yet.</p>';
      return;
    }
    document.getElementById("historyTable").innerHTML = buildBookingTable(
      bookings,
      false,
    );
  } catch (e) {
    document.getElementById("historyTable").innerHTML =
      '<p class="error-msg">' + e.message + "</p>";
  }
}

// ── Admin tabs ────────────────────────────────────────────────────────────────

function showAdminTab(tab) {
  ["alerts", "history", "map", "bikes", "users"].forEach((t) => {
    document.getElementById("admin-" + t).style.display = "none";
    const link = document.getElementById("anav-" + t);
    if (link) link.classList.remove("active");
  });
  document.getElementById("admin-" + tab).style.display = "block";
  const link = document.getElementById("anav-" + tab);
  if (link) link.classList.add("active");

  clearInterval(mapRefreshTimer);

  if (tab === "alerts") loadAdminAlerts();
  if (tab === "history") loadAdminBookings();
  if (tab === "map") initMap();
  if (tab === "bikes") loadAdminBikes();
  if (tab === "users") loadAdminUsers();
}

// ── Admin: Alerts ─────────────────────────────────────────────────────────────

async function loadAdminAlerts() {
  const el = document.getElementById("adminAlertsList");
  el.innerHTML = '<p style="color:#888">Loading...</p>';
  try {
    const alerts = await apiFetch("/admin/alerts");
    if (!alerts.length) {
      el.innerHTML = '<p class="empty-msg">No alerts.</p>';
      return;
    }
    el.innerHTML = alerts
      .map(
        (a) => `
      <div class="alert-card ${a.resolved ? "resolved" : ""}">
        <div>
          <div class="alert-type">${a.type}</div>
          <div class="alert-msg">${esc(a.message)}</div>
          <div class="alert-time">${a.user_name ? "User: " + esc(a.user_name) + " &bull; " : ""}${formatTime(a.created_at)}</div>
        </div>
        ${
          !a.resolved
            ? '<button class="btn-resolve" onclick="resolveAlert(' +
              a.id +
              ')">Resolve</button>'
            : '<span class="resolved-label">Resolved</span>'
        }
      </div>
    `,
      )
      .join("");
  } catch (e) {
    el.innerHTML = '<p class="error-msg">' + e.message + "</p>";
  }
}

async function resolveAlert(id) {
  await apiFetch("/admin/alerts/" + id + "/resolve", { method: "POST" });
  loadAdminAlerts();
}

// ── Admin: All Bookings ───────────────────────────────────────────────────────

async function loadAdminBookings() {
  const el = document.getElementById("adminBookingsList");
  el.innerHTML = '<p style="color:#888">Loading...</p>';
  try {
    allBookings = await apiFetch("/admin/bookings");
    renderBookingsTable(allBookings);
  } catch (e) {
    el.innerHTML = '<p class="error-msg">' + e.message + "</p>";
  }
}

function filterBookings() {
  const q = document.getElementById("bookingSearch").value.toLowerCase();
  const filtered = allBookings.filter(
    (b) =>
      b.user_name.toLowerCase().includes(q) ||
      b.college_id.toLowerCase().includes(q) ||
      b.bike_code.toLowerCase().includes(q) ||
      b.status.toLowerCase().includes(q),
  );
  renderBookingsTable(filtered);
}

function renderBookingsTable(bookings) {
  const el = document.getElementById("adminBookingsList");
  if (!bookings.length) {
    el.innerHTML = '<p class="empty-msg">No bookings found.</p>';
    return;
  }
  el.innerHTML = buildBookingTable(bookings, true);
}

function buildBookingTable(bookings, showUser) {
  const userCol = showUser ? "<th>Student</th>" : "";
  const rows = bookings
    .map((b) => {
      const userCell = showUser
        ? "<td>" +
          esc(b.user_name) +
          '<br><span class="college-id">' +
          esc(b.college_id) +
          "</span></td>"
        : "";
      return (
        "<tr>" +
        userCell +
        `
      <td><strong>${esc(b.bike_code)}</strong></td>
      <td>${esc(b.stand_name)}</td>
      <td><span class="badge badge-${b.status.toLowerCase()}">${b.status}</span></td>
      <td>${formatTime(b.return_by)}</td>
      <td>${formatTime(b.created_at)}</td>
    </tr>`
      );
    })
    .join("");
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${userCol}<th>Bike</th><th>Stand</th><th>Status</th><th>Return By</th><th>Booked At</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function formatBikeStatus(bike) {
  if (bike.status === "AVAILABLE") return "Available";
  if (bike.status === "BOOKED") return "Booked for pickup";
  if (bike.status === "IN_USE") return "Currently in use";
  if (bike.status === "MISSING") return "Marked missing";
  return esc(bike.status || "Unknown");
}

// ── Admin: Live Map ───────────────────────────────────────────────────────────

async function initMap() {
  // Only init Leaflet once
  if (!leafletMap) {
    leafletMap = L.map("liveMap").setView([26.851, 75.8005], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(leafletMap);

    // Add stand markers
    const stands = await apiFetch("/stands");
    stands.forEach((s) => {
      const marker = L.marker([s.lat, s.lng], { icon: standIcon() })
        .addTo(leafletMap)
        .bindPopup("<strong>" + esc(s.name) + "</strong><br>Bike Stand");
      standMarkers.push(marker);
    });
  }

  await refreshMap();
  mapRefreshTimer = setInterval(refreshMap, 5000);
}

async function refreshMap() {
  try {
    const [bikes, paths] = await Promise.all([
      apiFetch("/admin/live-bikes"),
      apiFetch("/admin/bike-paths"),
    ]);

    bikeMarkers.forEach((m) => leafletMap.removeLayer(m));
    bikeMarkers = [];

    // Remove polylines for bookings no longer active
    const activeBookingIds = new Set(bikes.map((b) => String(b.booking_id)));
    for (const bid of Object.keys(bikePolylines)) {
      if (!activeBookingIds.has(bid)) {
        leafletMap.removeLayer(bikePolylines[bid]);
        delete bikePolylines[bid];
      }
    }

    const infoBar = document.getElementById("liveMapInfo");

    if (!bikes.length) {
      infoBar.innerHTML =
        '<span class="map-info-none">No bikes currently in use.</span>';
      return;
    }

    infoBar.innerHTML =
      "<strong>" +
      bikes.length +
      " bike" +
      (bikes.length !== 1 ? "s" : "") +
      " currently out:</strong> " +
      bikes.map((b) => b.code).join(", ");

    bikes.forEach((b) => {
      if (!b.last_lat || !b.last_lng) return;
      const overdue = Math.floor(Date.now() / 1000) > b.return_by;
      const bid = String(b.booking_id);

      // Draw / update path polyline
      const trail = (paths[bid] || []).map((p) => [p.lat, p.lng]);
      if (trail.length > 1) {
        if (bikePolylines[bid]) {
          bikePolylines[bid].setLatLngs(trail);
        } else {
          bikePolylines[bid] = L.polyline(trail, {
            color: overdue ? "#e53935" : "#1565c0",
            weight: 4,
            opacity: 0.75,
            dashArray: null,
          }).addTo(leafletMap);
        }
      }

      const marker = L.marker([b.last_lat, b.last_lng], {
        icon: bikeIcon(overdue),
      })
        .addTo(leafletMap)
        .bindPopup(
          "<strong>" +
            esc(b.code) +
            "</strong><br>" +
            "Rider: " +
            esc(b.user_name) +
            " (" +
            esc(b.college_id) +
            ")<br>" +
            "Return by: " +
            formatTime(b.return_by) +
            (overdue
              ? '<br><span style="color:#e53935;font-weight:700">OVERDUE</span>'
              : ""),
        );
      bikeMarkers.push(marker);
    });

    if (bikeMarkers.length > 0) {
      const group = L.featureGroup([...bikeMarkers, ...standMarkers]);
      leafletMap.fitBounds(group.getBounds().pad(0.2));
    }
  } catch (e) {
    document.getElementById("liveMapInfo").innerHTML =
      '<span class="error-msg">' + e.message + "</span>";
  }
}

function bikeIcon(overdue) {
  return L.divIcon({
    className: "",
    html:
      '<div class="map-marker bike-marker ' +
      (overdue ? "overdue" : "") +
      '">&#x1F6B2;</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function standIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="map-marker stand-marker">P</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// ── Admin: Bikes ──────────────────────────────────────────────────────────────

async function loadAdminBikes() {
  const el = document.getElementById("adminBikesList");
  el.innerHTML = '<p style="color:#888">Loading...</p>';
  try {
    const bikes = await apiFetch("/admin/bikes");
    el.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Code</th><th>Status</th><th>Stand</th><th>Battery</th><th>Last GPS</th></tr></thead>
          <tbody>
            ${bikes
              .map(
                (b) => `
              <tr>
                <td><strong>${esc(b.code)}</strong></td>
                <td><span class="badge badge-${b.status.toLowerCase()}">${b.status}</span></td>
                <td>${b.stand_name ? esc(b.stand_name) : "&mdash;"}</td>
                <td>${batteryHtml(b.battery_level)}</td>
                <td class="gps-cell">${b.last_lat ? b.last_lat.toFixed(5) + ", " + b.last_lng.toFixed(5) : "&mdash;"}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = '<p class="error-msg">' + e.message + "</p>";
  }
}

// ── Admin: Users ──────────────────────────────────────────────────────────────

async function loadAdminUsers() {
  const el = document.getElementById("adminUsersList");
  el.innerHTML = '<p style="color:#888">Loading...</p>';
  try {
    const users = await apiFetch("/admin/users");
    el.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>College ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${users
              .map(
                (u) => `
              <tr>
                <td>${esc(u.college_id)}</td>
                <td>${esc(u.name)}</td>
                <td>${esc(u.email)}</td>
                <td>${u.is_admin ? '<span class="badge badge-admin">Admin</span>' : "Student"}</td>
                <td>${u.is_banned ? '<span class="badge badge-flagged">BANNED</span>' : '<span class="badge badge-completed">Active</span>'}</td>
                <td>${u.is_banned && !u.is_admin ? '<button class="btn-unban" onclick="unbanUser(' + u.id + ')">Unban</button>' : ""}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = '<p class="error-msg">' + e.message + "</p>";
  }
}

async function unbanUser(id) {
  if (!confirm("Unban this user?")) return;
  await apiFetch("/admin/unban/" + id, { method: "POST" });
  loadAdminUsers();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatTime(unix) {
  if (!unix) return "&mdash;";
  return new Date(unix * 1000).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function batteryHtml(level) {
  if (level == null) return "";
  const color = level < 20 ? "#c62828" : level < 50 ? "#e65100" : "#2e7d32";
  const icon = level < 20 ? "🪫" : "🔋";
  return `<span style="color:${color};font-size:0.8rem;font-weight:600">${icon} ${level}%</span>`;
}

function esc(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function copyOTP() {
  navigator.clipboard
    .writeText(document.getElementById("otpDisplay").textContent)
    .then(() => {
      const btn = document.querySelector(".btn-copy");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy OTP"), 1500);
    });
}
