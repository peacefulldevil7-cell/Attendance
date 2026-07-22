/**
 * firebase-config.js
 * ---------------------------------------------------------------------------
 * Central Firebase setup for the Attendance Management System.
 *
 * 1. Replace the placeholder values below with the config object from your
 *    own Firebase project (Project settings -> General -> Your apps -> SDK
 *    setup and configuration).
 * 2. This file is loaded with a plain <script> tag (no bundler needed) so the
 *    whole app works as a static site on GitHub Pages.
 * 3. Uses the Firebase "compat" SDK so it can be dropped in with <script>
 *    tags, no build step required.
 * ---------------------------------------------------------------------------
 */

// TODO: replace with your own Firebase project credentials
const firebaseConfig = {
  apiKey: "AIzaSyCtYarQ1iHFVMTzYsQrb--Ijw5eLqU_0GY",
  authDomain: "attendance-d43f6.firebaseapp.com",
  projectId: "attendance-d43f6",
  storageBucket: "attendance-d43f6.firebasestorage.app",
  messagingSenderId: "118948243031",
  appId: "1:118948243031:web:162dc9b754946a91d82512"
};

// Initialize the primary Firebase app (used for the signed-in session)
firebase.initializeApp(firebaseConfig);

// Shared handles used across login.js / admin.js / employee.js
const auth = firebase.auth();
const db = firebase.firestore();

// Enable Firestore offline persistence -> this gives us "local caching" for
// free: reads are served from an on-disk cache when offline / slow network,
// and writes are queued and synced automatically once back online.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  // Multiple tabs open, or unsupported browser -> persistence just won't be
  // enabled; the app still works, it simply won't cache offline.
  console.warn("Firestore persistence not enabled:", err.code);
});

/**
 * A second, isolated Firebase app instance.
 *
 * WHY: Firebase Auth's client SDK automatically signs in as whichever user
 * you last created/signed-in with. Without this trick, when an Admin creates
 * a new Employee account with createUserWithEmailAndPassword(), the Admin
 * would be signed out and replaced by the brand-new Employee session.
 * By creating employee accounts through a completely separate ("Secondary")
 * app instance, the Admin's own session on the primary `auth` object is left
 * untouched.
 */
function getSecondaryAuth() {
  let secondaryApp = firebase.apps.find((a) => a.name === "Secondary");
  if (!secondaryApp) {
    secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
  }
  return secondaryApp.auth();
}

// ---------------------------------------------------------------------------
// Local cache helpers (localStorage) - used to render dashboards instantly
// while fresh data streams in from Firestore in the background.
// ---------------------------------------------------------------------------
const LocalCache = {
  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() }));
    } catch (e) {
      console.warn("LocalCache.set failed", e);
    }
  },
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw).data;
    } catch (e) {
      return null;
    }
  },
  clear(key) {
    localStorage.removeItem(key);
  }
};

// ---------------------------------------------------------------------------
// Session helpers - small bits of user info kept in sessionStorage so pages
// can render a name/role instantly without waiting on an auth round-trip.
// ---------------------------------------------------------------------------
const Session = {
  set(profile) {
    sessionStorage.setItem("ams_profile", JSON.stringify(profile));
  },
  get() {
    try {
      return JSON.parse(sessionStorage.getItem("ams_profile"));
    } catch (e) {
      return null;
    }
  },
  clear() {
    sessionStorage.removeItem("ams_profile");
  }
};

// ---------------------------------------------------------------------------
// Toast notifications - shared across index.html / admin.html / employee.html
// Each page just needs a <div id="toast-container"></div> in its markup.
// ---------------------------------------------------------------------------
const Toast = {
  icons: { success: "✓", error: "✕", warning: "!", info: "ℹ" },

  show(message, type = "info", duration = 3800) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${this.icons[type] || this.icons.info}</span>
      <span class="toast-msg">${message}</span>
      <button class="toast-close" aria-label="Dismiss">✕</button>
    `;

    toast.querySelector(".toast-close").addEventListener("click", () => this.dismiss(toast));
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }
  },

  dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 200);
  },

  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error"); },
  warning(msg) { this.show(msg, "warning"); },
  info(msg) { this.show(msg, "info"); }
};

// ---------------------------------------------------------------------------
// Dark mode - persisted in localStorage, respects OS preference on first
// visit. Call ThemeManager.init() on every page, ThemeManager.toggle() on the
// theme switch control.
// ---------------------------------------------------------------------------
const ThemeManager = {
  key: "ams_theme",

  init() {
    const saved = localStorage.getItem(this.key);
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    this.apply(theme);
  },

  apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(this.key, theme);
    document.querySelectorAll(".theme-toggle .knob").forEach((k) => {
      k.textContent = theme === "dark" ? "🌙" : "☀️";
    });
  },

  toggle() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    this.apply(current === "dark" ? "light" : "dark");
  }
};

// ---------------------------------------------------------------------------
// Small formatting helpers reused by admin.js / employee.js
// ---------------------------------------------------------------------------
const Fmt = {
  todayKey(date = new Date()) {
    // YYYY-MM-DD, used as a stable per-day document / lookup key
    return date.toISOString().slice(0, 10);
  },
  time(date) {
    if (!date) return "--:--";
    const d = date instanceof Date ? date : date.toDate();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  },
  dateLong(date) {
    if (!date) return "-";
    const d = date instanceof Date ? date : date.toDate();
    return d.toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  },
  initials(name = "") {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join("");
  },
  hoursBetween(inDate, outDate) {
    if (!inDate || !outDate) return null;
    const a = inDate instanceof Date ? inDate : inDate.toDate();
    const b = outDate instanceof Date ? outDate : outDate.toDate();
    const hrs = (b - a) / (1000 * 60 * 60);
    return Math.max(0, hrs).toFixed(1);
  }
};
