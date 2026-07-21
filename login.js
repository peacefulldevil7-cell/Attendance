/**
 * login.js
 * ---------------------------------------------------------------------------
 * Handles the login page (index.html):
 *  - Restores theme preference
 *  - Redirects instantly if a session already exists
 *  - Signs the user in with Firebase Authentication
 *  - Looks up the user's role in Firestore (never trusts the UI toggle)
 *  - Redirects to admin.html or employee.html
 * ---------------------------------------------------------------------------
 */

ThemeManager.init();

const pageLoader = document.getElementById("page-loader");
const loginCard = document.getElementById("login-card");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const loginBtnText = document.getElementById("login-btn-text");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const roleEmployeeBtn = document.getElementById("role-employee-btn");
const roleAdminBtn = document.getElementById("role-admin-btn");

let selectedRole = "employee";

roleEmployeeBtn.addEventListener("click", () => setRole("employee"));
roleAdminBtn.addEventListener("click", () => setRole("admin"));

function setRole(role) {
  selectedRole = role;
  roleEmployeeBtn.classList.toggle("active", role === "employee");
  roleAdminBtn.classList.toggle("active", role === "admin");
}

/** Reveal the login form once we know there's no active session. */
function showLoginForm() {
  pageLoader.classList.add("hidden");
  loginCard.classList.remove("hidden");
}

/**
 * Reads the employee/admin profile document for a signed-in user and routes
 * them to the correct dashboard. This is the single source of truth for
 * role - the role toggle on screen is only a UX shortcut.
 */
async function routeUserByRole(user) {
  try {
    const doc = await db.collection("employees").doc(user.uid).get();

    if (!doc.exists) {
      await auth.signOut();
      pageLoader.classList.add("hidden");
      loginCard.classList.remove("hidden");
      Toast.error("No profile found for this account. Contact your admin.");
      return;
    }

    const profile = doc.data();

    if (profile.active === false) {
      await auth.signOut();
      pageLoader.classList.add("hidden");
      loginCard.classList.remove("hidden");
      Toast.error("This account has been deactivated.");
      return;
    }

    Session.set({
      uid: user.uid,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      employeeId: profile.employeeId || "",
      department: profile.department || ""
    });
    LocalCache.set("ams_my_profile", profile);

    window.location.href = profile.role === "admin" ? "admin.html" : "employee.html";
  } catch (err) {
    console.error(err);
    pageLoader.classList.add("hidden");
    loginCard.classList.remove("hidden");
    Toast.error("Couldn't verify your account. Check your connection and try again.");
  }
}

// If a session already exists (e.g. user hit back button, or revisited the
// site), skip the form and go straight to the right dashboard.
auth.onAuthStateChanged((user) => {
  if (user) {
    routeUserByRole(user);
  } else {
    showLoginForm();
  }
});

// Fallback: if Firebase takes too long (offline etc.) still show the form.
setTimeout(() => {
  if (pageLoader && !pageLoader.classList.contains("hidden")) showLoginForm();
}, 4000);

function validateForm() {
  let valid = true;
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  emailError.style.display = emailOk ? "none" : "block";
  if (!emailOk) valid = false;

  const passOk = password.length >= 6;
  passwordError.style.display = passOk ? "none" : "block";
  if (!passOk) valid = false;

  return valid;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateForm()) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  loginBtn.disabled = true;
  loginBtnText.innerHTML = '<span class="spinner"></span> Signing in…';

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    await routeUserByRole(cred.user);
  } catch (err) {
    console.error(err);
    let message = "Something went wrong. Please try again.";
    switch (err.code) {
      case "auth/invalid-email":
        message = "That email address looks invalid.";
        break;
      case "auth/user-not-found":
      case "auth/invalid-credential":
      case "auth/wrong-password":
        message = "Incorrect email or password.";
        break;
      case "auth/too-many-requests":
        message = "Too many attempts. Please wait a moment and try again.";
        break;
      case "auth/network-request-failed":
        message = "Network error. Check your connection.";
        break;
    }
    Toast.error(message);
  } finally {
    loginBtn.disabled = false;
    loginBtnText.textContent = "Sign in";
  }
});
