/**
 * admin.js
 * ---------------------------------------------------------------------------
 * Powers admin.html:
 *  - Guards the page (must be signed in AND have role === "admin")
 *  - Renders live dashboard stat cards + today's attendance
 *  - Employee CRUD (create auth account + Firestore profile / edit / delete)
 *  - Attendance table with employee + date filters
 *  - CSV export of the currently filtered attendance
 *  - Local caching so tables render instantly on repeat visits
 * ---------------------------------------------------------------------------
 */

ThemeManager.init();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allEmployees = [];      // full employee list from Firestore
let allAttendanceToday = []; // today's attendance docs
let allAttendance = [];      // attendance docs for the Attendance tab (filtered)
let unsubEmployees = null;
let unsubAttendance = null;
let deleteTargetUid = null;

const LATE_CUTOFF_HOUR = 9;
const LATE_CUTOFF_MIN = 30;

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

// ---------------------------------------------------------------------------
// Auth guard: must be logged in AND be an admin
// ---------------------------------------------------------------------------
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    const doc = await db.collection("employees").doc(user.uid).get();
    if (!doc.exists || doc.data().role !== "admin") {
      Toast.error("You don't have access to the admin console.");
      await auth.signOut();
      window.location.href = "index.html";
      return;
    }

    const profile = doc.data();
    document.getElementById("admin-name").textContent = profile.name || "Admin";
    document.getElementById("admin-initials").textContent = Fmt.initials(profile.name || "A");

    pageLoader.classList.add("hidden");
    appShell.classList.remove("hidden");

    initDashboard();
  } catch (err) {
    console.error(err);
    Toast.error("Couldn't verify admin access.");
    window.location.href = "index.html";
  }
});

logoutBtn.addEventListener("click", async () => {
  if (unsubEmployees) unsubEmployees();
  if (unsubAttendance) unsubAttendance();
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
// Dashboard bootstrap
// ---------------------------------------------------------------------------
function initDashboard() {
  document.getElementById("today-date-label").textContent = Fmt.dateLong(new Date());

  // Render from cache immediately for a fast first paint, then let the
  // Firestore listeners below replace it with live data.
  const cachedEmployees = LocalCache.get("ams_employees");
  if (cachedEmployees) {
    allEmployees = cachedEmployees;
    renderEmployeesTable();
    populateEmployeeFilter();
  }

  listenEmployees();
  listenAttendanceToday();
  listenAttendanceAll();
}

// ---------------------------------------------------------------------------
// Employees: live listener + cache
// ---------------------------------------------------------------------------
function listenEmployees() {
  unsubEmployees = db.collection("employees").orderBy("name").onSnapshot(
    (snap) => {
      allEmployees = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      LocalCache.set("ams_employees", allEmployees);
      renderEmployeesTable();
      populateEmployeeFilter();
      renderStatCards();
    },
    (err) => {
      console.error(err);
      Toast.error("Couldn't load employees. Showing cached data if available.");
    }
  );
}

function renderEmployeesTable() {
  const tbody = document.getElementById("employees-table-body");
  const query = (document.getElementById("employee-search").value || "").toLowerCase().trim();

  const filtered = allEmployees.filter((e) => {
    if (!query) return true;
    return (
      (e.name || "").toLowerCase().includes(query) ||
      (e.email || "").toLowerCase().includes(query) ||
      (e.employeeId || "").toLowerCase().includes(query) ||
      (e.department || "").toLowerCase().includes(query)
    );
  });

  document.getElementById("employee-count-label").textContent = `${allEmployees.length} total employee(s)`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="emoji">🔍</span>No employees match your search.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (e) => `
    <tr>
      <td class="cell-name">${escapeHtml(e.name || "-")}</td>
      <td class="cell-mono">${escapeHtml(e.employeeId || "-")}</td>
      <td>${escapeHtml(e.department || "-")}</td>
      <td class="cell-muted">${escapeHtml(e.email || "-")}</td>
      <td><span class="badge ${e.active === false ? "badge-inactive" : "badge-active"}">${e.active === false ? "Inactive" : "Active"}</span></td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" data-edit="${e.uid}">Edit</button>
        <button class="btn btn-danger btn-sm" data-delete="${e.uid}">Delete</button>
      </td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openEmployeeModal(btn.dataset.edit))
  );
  tbody.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => openDeleteConfirm(btn.dataset.delete))
  );
}

document.getElementById("employee-search").addEventListener("input", renderEmployeesTable);

function populateEmployeeFilter() {
  const select = document.getElementById("attendance-employee-filter");
  const current = select.value;
  select.innerHTML =
    `<option value="">All employees</option>` +
    allEmployees.map((e) => `<option value="${e.uid}">${escapeHtml(e.name)}</option>`).join("");
  select.value = current;
}

// ---------------------------------------------------------------------------
// Dashboard stat cards + "today's attendance" table (Overview tab)
// ---------------------------------------------------------------------------
function listenAttendanceToday() {
  const today = Fmt.todayKey();
  db.collection("attendance")
    .where("date", "==", today)
    .onSnapshot(
      (snap) => {
        allAttendanceToday = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderOverviewTable();
        renderStatCards();
      },
      (err) => console.error(err)
    );
}

function renderStatCards() {
  const total = allEmployees.filter((e) => e.active !== false).length;
  const presentCount = allAttendanceToday.filter((a) => a.checkIn).length;
  const lateCount = allAttendanceToday.filter((a) => a.status === "Late").length;
  const absentCount = Math.max(0, total - presentCount);

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-present").textContent = presentCount;
  document.getElementById("stat-late").textContent = lateCount;
  document.getElementById("stat-absent").textContent = absentCount;
}

function renderOverviewTable() {
  const tbody = document.getElementById("overview-table-body");

  if (allAttendanceToday.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><span class="emoji">🗓️</span>No check-ins recorded yet today.</div></td></tr>`;
    return;
  }

  const rows = allAttendanceToday
    .slice()
    .sort((a, b) => (b.checkIn?.seconds || 0) - (a.checkIn?.seconds || 0))
    .map((a) => {
      const railColor = statusRailColor(a.status);
      return `
      <tr>
        <td class="rail-cell" style="--rail-color:${railColor}">
          <span class="cell-name">${escapeHtml(a.employeeName || "-")}</span>
        </td>
        <td class="cell-muted">${escapeHtml(a.department || "-")}</td>
        <td class="cell-mono">${a.checkIn ? Fmt.time(a.checkIn) : "--:--"}</td>
        <td class="cell-mono">${a.checkOut ? Fmt.time(a.checkOut) : "--:--"}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>`;
    })
    .join("");

  tbody.innerHTML = rows;
}

// ---------------------------------------------------------------------------
// Attendance tab: full listener with client-side filtering
// ---------------------------------------------------------------------------
function listenAttendanceAll() {
  unsubAttendance = db
    .collection("attendance")
    .orderBy("date", "desc")
    .limit(500) // keep the export snappy; increase if you need deeper history
    .onSnapshot(
      (snap) => {
        allAttendance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        LocalCache.set("ams_attendance", allAttendance);
        renderAttendanceTable();
      },
      (err) => {
        console.error(err);
        const cached = LocalCache.get("ams_attendance");
        if (cached) {
          allAttendance = cached;
          renderAttendanceTable();
        }
        Toast.warning("Showing cached attendance — live sync failed.");
      }
    );
}

function getFilteredAttendance() {
  const empId = document.getElementById("attendance-employee-filter").value;
  const date = document.getElementById("attendance-date-filter").value;

  return allAttendance.filter((a) => {
    if (empId && a.uid !== empId) return false;
    if (date && a.date !== date) return false;
    return true;
  });
}

function renderAttendanceTable() {
  const tbody = document.getElementById("attendance-table-body");
  const filtered = getFilteredAttendance();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="emoji">📭</span>No attendance records match these filters.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((a) => {
      const railColor = statusRailColor(a.status);
      const hours = a.checkIn && a.checkOut ? Fmt.hoursBetween(a.checkIn, a.checkOut) : "-";
      return `
      <tr>
        <td class="rail-cell" style="--rail-color:${railColor}">
          <span class="cell-name">${escapeHtml(a.employeeName || "-")}</span>
        </td>
        <td class="cell-muted">${a.date}</td>
        <td class="cell-mono">${a.checkIn ? Fmt.time(a.checkIn) : "--:--"}</td>
        <td class="cell-mono">${a.checkOut ? Fmt.time(a.checkOut) : "--:--"}</td>
        <td class="cell-mono">${hours}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>`;
    })
    .join("");
}

document.getElementById("attendance-employee-filter").addEventListener("change", renderAttendanceTable);
document.getElementById("attendance-date-filter").addEventListener("change", renderAttendanceTable);
document.getElementById("attendance-clear-filter").addEventListener("click", () => {
  document.getElementById("attendance-employee-filter").value = "";
  document.getElementById("attendance-date-filter").value = "";
  renderAttendanceTable();
});

// ---------------------------------------------------------------------------
// CSV export of whatever is currently filtered on the Attendance tab
// ---------------------------------------------------------------------------
document.getElementById("download-csv-btn").addEventListener("click", () => {
  const rows = getFilteredAttendance();
  if (rows.length === 0) {
    Toast.warning("Nothing to export for the current filters.");
    return;
  }

  const header = ["Employee", "Employee ID", "Department", "Date", "Check In", "Check Out", "Hours", "Status"];
  const csvRows = [header.join(",")];

  rows.forEach((a) => {
    const hours = a.checkIn && a.checkOut ? Fmt.hoursBetween(a.checkIn, a.checkOut) : "";
    const line = [
      a.employeeName || "",
      a.employeeId || "",
      a.department || "",
      a.date || "",
      a.checkIn ? Fmt.time(a.checkIn) : "",
      a.checkOut ? Fmt.time(a.checkOut) : "",
      hours,
      a.status || ""
    ].map(csvEscape);
    csvRows.push(line.join(","));
  });

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance_export_${Fmt.todayKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  Toast.success("CSV downloaded.");
});

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// Add / Edit employee modal
// ---------------------------------------------------------------------------
const employeeModalBackdrop = document.getElementById("employee-modal-backdrop");
const employeeForm = document.getElementById("employee-form");
const employeeModalTitle = document.getElementById("employee-modal-title");
const employeePasswordField = document.getElementById("emp-password-field");
const employeeSaveBtn = document.getElementById("employee-save-btn");

document.getElementById("add-employee-btn").addEventListener("click", () => openEmployeeModal(null));
document.getElementById("employee-modal-close").addEventListener("click", closeEmployeeModal);
document.getElementById("employee-modal-cancel").addEventListener("click", closeEmployeeModal);

function openEmployeeModal(uid) {
  employeeForm.reset();
  document.getElementById("emp-uid").value = "";

  if (uid) {
    const emp = allEmployees.find((e) => e.uid === uid);
    if (!emp) return;
    employeeModalTitle.textContent = "Edit employee";
    employeePasswordField.classList.add("hidden"); // can't change password from here
    document.getElementById("emp-uid").value = emp.uid;
    document.getElementById("emp-name").value = emp.name || "";
    document.getElementById("emp-email").value = emp.email || "";
    document.getElementById("emp-email").disabled = true; // email tied to auth account
    document.getElementById("emp-id").value = emp.employeeId || "";
    document.getElementById("emp-department").value = emp.department || "";
    document.getElementById("emp-position").value = emp.position || "";
    document.getElementById("emp-phone").value = emp.phone || "";
    document.getElementById("emp-role").value = emp.role || "employee";
    document.getElementById("emp-status").value = String(emp.active !== false);
  } else {
    employeeModalTitle.textContent = "Add employee";
    employeePasswordField.classList.remove("hidden");
    document.getElementById("emp-email").disabled = false;
  }

  employeeModalBackdrop.classList.remove("hidden");
}

function closeEmployeeModal() {
  employeeModalBackdrop.classList.add("hidden");
}

employeeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const uid = document.getElementById("emp-uid").value;
  const name = document.getElementById("emp-name").value.trim();
  const email = document.getElementById("emp-email").value.trim();
  const password = document.getElementById("emp-password").value;
  const employeeId = document.getElementById("emp-id").value.trim();
  const department = document.getElementById("emp-department").value.trim();
  const position = document.getElementById("emp-position").value.trim();
  const phone = document.getElementById("emp-phone").value.trim();
  const role = document.getElementById("emp-role").value;
  const active = document.getElementById("emp-status").value === "true";

  employeeSaveBtn.disabled = true;
  employeeSaveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    if (uid) {
      // ---- EDIT existing employee (Firestore profile only) ----
      await db.collection("employees").doc(uid).update({
        name, employeeId, department, position, phone, role, active,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      Toast.success("Employee updated.");
    } else {
      // ---- ADD new employee (Auth account + Firestore profile) ----
      if (password.length < 6) {
        Toast.error("Temporary password must be at least 6 characters.");
        employeeSaveBtn.disabled = false;
        employeeSaveBtn.textContent = "Save employee";
        return;
      }

      // Use the secondary Firebase app so creating this account does NOT
      // sign the admin out of their own session (see firebase-config.js).
      const secondaryAuth = getSecondaryAuth();
      const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
      const newUid = cred.user.uid;
      await secondaryAuth.signOut();

      await db.collection("employees").doc(newUid).set({
        name, email, employeeId, department, position, phone, role, active,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      Toast.success("Employee added. Share the temporary password securely.");
    }

    closeEmployeeModal();
  } catch (err) {
    console.error(err);
    let message = "Couldn't save employee.";
    if (err.code === "auth/email-already-in-use") message = "That email is already registered.";
    if (err.code === "auth/invalid-email") message = "That email address looks invalid.";
    if (err.code === "auth/weak-password") message = "Password is too weak (min 6 characters).";
    Toast.error(message);
  } finally {
    employeeSaveBtn.disabled = false;
    employeeSaveBtn.textContent = "Save employee";
  }
});

// ---------------------------------------------------------------------------
// Delete employee
// ---------------------------------------------------------------------------
const confirmModalBackdrop = document.getElementById("confirm-modal-backdrop");

function openDeleteConfirm(uid) {
  deleteTargetUid = uid;
  const emp = allEmployees.find((e) => e.uid === uid);
  document.getElementById("confirm-modal-text").textContent = emp
    ? `This will permanently remove ${emp.name}'s profile from the directory. Their attendance history is kept for records. Their sign-in access will need to be revoked separately in the Firebase console (client apps can't delete other users' auth accounts).`
    : "This will permanently remove this employee's profile.";
  confirmModalBackdrop.classList.remove("hidden");
}

document.getElementById("confirm-modal-close").addEventListener("click", () => confirmModalBackdrop.classList.add("hidden"));
document.getElementById("confirm-cancel-btn").addEventListener("click", () => confirmModalBackdrop.classList.add("hidden"));

document.getElementById("confirm-delete-btn").addEventListener("click", async () => {
  if (!deleteTargetUid) return;
  const btn = document.getElementById("confirm-delete-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner dark"></span> Removing…';

  try {
    await db.collection("employees").doc(deleteTargetUid).delete();
    Toast.success("Employee removed.");
    confirmModalBackdrop.classList.add("hidden");
  } catch (err) {
    console.error(err);
    Toast.error("Couldn't remove employee.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Yes, remove";
    deleteTargetUid = null;
  }
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

function statusRailColor(status) {
  const map = {
    Present: "var(--status-present)",
    Late: "var(--status-late)",
    "Half Day": "var(--status-halfday)",
    Absent: "var(--status-absent)"
  };
  return map[status] || "var(--border)";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
