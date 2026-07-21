/**
 * employee.js
 * ---------------------------------------------------------------------------
 * Powers employee.html:
 *  - Guards the page (must be signed in)
 *  - Live clock + today's check-in / check-out actions
 *  - Monthly summary stats
 *  - Full attendance history with a month filter
 *  - Local caching so the history renders instantly on repeat visits
 * ---------------------------------------------------------------------------
 */

ThemeManager.init();

const LATE_CUTOFF_HOUR = 9;
const LATE_CUTOFF_MIN = 30;

let currentUser = null;
let currentProfile = null;
let myAttendance = []; // all of this employee's attendance docs
let unsubHistory = null;
let clockInterval = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const pageLoader = document.getElementById("page-loader");
const appShell = document.getElementById("app-shell");
const sidebar = document.getElementById("sidebar");
const sidebarScrim = document.getElementById("sidebar-scrim");
const menuBtn = document.getElementById("menu-btn");
const sectionTitle = document.getElementById("section-title");
const themeToggleBtn = document.getElementById("theme-toggle");
const logoutBtn = document.getElementById("logout-btn");
const checkinBtn = document.getElementById("checkin-btn");
const checkoutBtn = document.getElementById("checkout-btn");

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;

  try {
    const doc = await db.collection("employees").doc(user.uid).get();
    if (!doc.exists) {
      Toast.error("No profile found for this account.");
      await auth.signOut();
      window.location.href = "index.html";
      return;
    }

    currentProfile = doc.data();
    document.getElementById("employee-name").textContent = currentProfile.name || "Employee";
    document.getElementById("employee-dept").textContent = currentProfile.department || "—";
    document.getElementById("employee-initials").textContent = Fmt.initials(currentProfile.name || "E");

    pageLoader.classList.add("hidden");
    appShell.classList.remove("hidden");

    startClock();
    initHistory();
  } catch (err) {
    console.error(err);
    Toast.error("Couldn't load your profile.");
  }
});

logoutBtn.addEventListener("click", async () => {
  if (unsubHistory) unsubHistory();
  if (clockInterval) clearInterval(clockInterval);
  Session.clear();
  await auth.signOut();
  window.location.href = "index.html";
});

// ---------------------------------------------------------------------------
// Sidebar navigation + mobile menu
// ---------------------------------------------------------------------------
document.querySelectorAll(".nav-link[data-section]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-link[data-section]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll("main.content > section").forEach((s) => s.classList.add("hidden"));
    document.getElementById(`section-${btn.dataset.section}`).classList.remove("hidden");

    sectionTitle.textContent = btn.textContent.trim();
    closeMobileSidebar();
  });
});

menuBtn.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarScrim.classList.add("show");
});
sidebarScrim.addEventListener("click", closeMobileSidebar);
function closeMobileSidebar() {
  sidebar.classList.remove("open");
  sidebarScrim.classList.remove("show");
}

themeToggleBtn.addEventListener("click", () => ThemeManager.toggle());

// ---------------------------------------------------------------------------
// Live clock
// ---------------------------------------------------------------------------
function startClock() {
  tickClock();
  clockInterval = setInterval(tickClock, 1000);
}

function tickClock() {
  const now = new Date();
  document.getElementById("live-clock").textContent = now.toLocaleTimeString([], { hour12: true });
  document.getElementById("live-date").textContent = now.toLocaleDateString([], {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

// ---------------------------------------------------------------------------
// Attendance history: single live listener, everything else derives from it
// ---------------------------------------------------------------------------
function initHistory() {
  const cached = LocalCache.get(`ams_history_${currentUser.uid}`);
  if (cached) {
    myAttendance = cached;
    renderAll();
  }

  unsubHistory = db
    .collection("attendance")
    .where("uid", "==", currentUser.uid)
    .orderBy("date", "desc")
    .limit(400)
    .onSnapshot(
      (snap) => {
        myAttendance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        LocalCache.set(`ams_history_${currentUser.uid}`, myAttendance);
        renderAll();
      },
      (err) => {
        console.error(err);
        Toast.warning("Showing cached history — live sync failed.");
      }
    );
}

function renderAll() {
  renderTodayCard();
  renderMonthSummary();
  renderRecentTable();
  renderHistoryTable();
}

// ---------------------------------------------------------------------------
// Today's punch card
// ---------------------------------------------------------------------------
function getTodayRecord() {
  const today = Fmt.todayKey();
  return myAttendance.find((a) => a.date === today) || null;
}

function renderTodayCard() {
  const record = getTodayRecord();
  const badge = document.getElementById("today-status-badge");

  document.getElementById("today-checkin-time").textContent = record?.checkIn ? Fmt.time(record.checkIn) : "--:--";
  document.getElementById("today-checkout-time").textContent = record?.checkOut ? Fmt.time(record.checkOut) : "--:--";

  if (!record || !record.checkIn) {
    badge.textContent = "Not checked in";
    badge.className = "badge badge-inactive";
    checkinBtn.classList.remove("hidden");
    checkoutBtn.classList.add("hidden");
  } else if (record.checkIn && !record.checkOut) {
    badge.textContent = record.status === "Late" ? "Checked in (Late)" : "Checked in";
    badge.className = `badge ${record.status === "Late" ? "badge-late" : "badge-present"}`;
    checkinBtn.classList.add("hidden");
    checkoutBtn.classList.remove("hidden");
  } else {
    badge.textContent = "Day complete";
    badge.className = "badge badge-present";
    checkinBtn.classList.add("hidden");
    checkoutBtn.classList.add("hidden");
  }
}

checkinBtn.addEventListener("click", async () => {
  checkinBtn.disabled = true;
  checkinBtn.innerHTML = '<span class="spinner"></span> Checking in…';

  try {
    const now = new Date();
    const isLate = now.getHours() > LATE_CUTOFF_HOUR || (now.getHours() === LATE_CUTOFF_HOUR && now.getMinutes() > LATE_CUTOFF_MIN);
    const docId = `${currentUser.uid}_${Fmt.todayKey()}`;

    await db.collection("attendance").doc(docId).set(
      {
        uid: currentUser.uid,
        employeeName: currentProfile.name,
        employeeId: currentProfile.employeeId || "",
        department: currentProfile.department || "",
        date: Fmt.todayKey(),
        checkIn: firebase.firestore.Timestamp.fromDate(now),
        status: isLate ? "Late" : "Present"
      },
      { merge: true }
    );

    Toast.success(isLate ? "Checked in — marked as late." : "Checked in. Have a great day!");
  } catch (err) {
    console.error(err);
    Toast.error("Couldn't check in. Please try again.");
  } finally {
    checkinBtn.disabled = false;
    checkinBtn.textContent = "Check in";
  }
});

checkoutBtn.addEventListener("click", async () => {
  checkoutBtn.disabled = true;
  checkoutBtn.innerHTML = '<span class="spinner"></span> Checking out…';

  try {
    const docId = `${currentUser.uid}_${Fmt.todayKey()}`;
    await db.collection("attendance").doc(docId).set(
      { checkOut: firebase.firestore.Timestamp.fromDate(new Date()) },
      { merge: true }
    );
    Toast.success("Checked out. See you next time!");
  } catch (err) {
    console.error(err);
    Toast.error("Couldn't check out. Please try again.");
  } finally {
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = "Check out";
  }
});

// ---------------------------------------------------------------------------
// This month's summary + recent 5 rows (Today tab)
// ---------------------------------------------------------------------------
function renderMonthSummary() {
  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7); // YYYY-MM
  document.getElementById("month-label").textContent = now.toLocaleDateString([], { month: "long", year: "numeric" });

  const monthRecords = myAttendance.filter((a) => a.date.startsWith(monthPrefix));
  const present = monthRecords.filter((a) => a.checkIn).length;
  const late = monthRecords.filter((a) => a.status === "Late").length;

  const hoursList = monthRecords
    .filter((a) => a.checkIn && a.checkOut)
    .map((a) => parseFloat(Fmt.hoursBetween(a.checkIn, a.checkOut)));
  const avgHours = hoursList.length ? (hoursList.reduce((a, b) => a + b, 0) / hoursList.length).toFixed(1) : "0.0";

  document.getElementById("month-present").textContent = present;
  document.getElementById("month-late").textContent = late;
  document.getElementById("month-avg-hours").textContent = avgHours;
}

function renderRecentTable() {
  const tbody = document.getElementById("recent-table-body");
  const recent = myAttendance.slice(0, 5);

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><span class="emoji">🗓️</span>No attendance recorded yet.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = recent
    .map(
      (a) => `
    <tr>
      <td class="cell-muted">${a.date}</td>
      <td class="cell-mono">${a.checkIn ? Fmt.time(a.checkIn) : "--:--"}</td>
      <td class="cell-mono">${a.checkOut ? Fmt.time(a.checkOut) : "--:--"}</td>
      <td>${statusBadge(a.status)}</td>
    </tr>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Full history tab with month filter
// ---------------------------------------------------------------------------
function renderHistoryTable() {
  const tbody = document.getElementById("history-table-body");
  const monthFilter = document.getElementById("history-month-filter").value; // YYYY-MM or ""

  const rows = myAttendance.filter((a) => (monthFilter ? a.date.startsWith(monthFilter) : true));

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><span class="emoji">📭</span>No attendance records for this period.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((a) => {
      const hours = a.checkIn && a.checkOut ? Fmt.hoursBetween(a.checkIn, a.checkOut) : "-";
      return `
      <tr>
        <td class="cell-muted">${a.date}</td>
        <td class="cell-mono">${a.checkIn ? Fmt.time(a.checkIn) : "--:--"}</td>
        <td class="cell-mono">${a.checkOut ? Fmt.time(a.checkOut) : "--:--"}</td>
        <td class="cell-mono">${hours}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>`;
    })
    .join("");
}

document.getElementById("history-month-filter").addEventListener("change", renderHistoryTable);
document.getElementById("history-clear-filter").addEventListener("click", () => {
  document.getElementById("history-month-filter").value = "";
  renderHistoryTable();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBadge(status) {
  const map = {
    Present: "badge-present",
    Late: "badge-late",
    "Half Day": "badge-halfday",
    Absent: "badge-absent"
  };
  return `<span class="badge ${map[status] || "badge-inactive"}">${status || "Absent"}</span>`;
}
