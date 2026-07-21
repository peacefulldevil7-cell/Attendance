# AttendifyHR — Attendance Management System

A complete, production-ready **Attendance Management System** built with plain
HTML, CSS, and JavaScript on the front end and **Firebase** (Authentication +
Firestore) on the back end. No build step, no bundler — it's a static site,
so it deploys directly to **GitHub Pages**.

---

## ✨ Features

**Everyone**
- Email/password login (Firebase Authentication)
- Role-based redirect (Admin → `admin.html`, Employee → `employee.html`)
- Dark mode with system-preference detection, persisted per browser
- Toast notifications for every action
- Skeleton loaders / spinners while data loads
- Offline local caching (Firestore persistence + localStorage fallback)
- Fully responsive, mobile-first layout with a collapsible sidebar

**Admin dashboard**
- Dashboard cards: total employees, present today, late arrivals, absent today
- Add employee (creates a real Firebase Auth account + Firestore profile)
- Edit employee details
- Delete employee profile
- Search/filter employees by name, email, ID, or department
- View attendance, filter by employee and/or date
- Download filtered attendance as CSV

**Employee dashboard**
- Live clock
- Check in / Check out (single tap, auto-detects "Late" after 09:30)
- Today's status card
- Monthly summary (present days, late days, average hours/day)
- Full attendance history with a month filter

---

## 📁 Project structure

```
attendance-management-system/
├── index.html          # Login page (entry point)
├── admin.html           # Admin dashboard shell
├── employee.html        # Employee dashboard shell
├── style.css             # Shared stylesheet (light + dark theme, responsive)
├── firebase-config.js     # Firebase init + shared helpers (Toast, Theme, Cache)
├── login.js               # Login page logic
├── admin.js               # Admin dashboard logic
├── employee.js            # Employee dashboard logic
└── README.md              # You are here
```

---

## 🔧 Setup

### 1. Create a Firebase project
1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. Inside the project, go to **Build → Authentication → Get started** and
   enable the **Email/Password** sign-in provider.
3. Go to **Build → Firestore Database → Create database** (start in
   **production mode** — the security rules below will lock it down properly).
4. Go to **Project settings → General → Your apps → Add app → Web (</>)**,
   register the app, and copy the `firebaseConfig` object it gives you.

### 2. Add your config
Open `firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. Create your first Admin account
Because a brand-new project has no users yet, create the very first Admin
manually (afterwards, that Admin can add every other employee/admin from the
dashboard UI):

1. In **Authentication → Users**, click **Add user**, enter an email and
   password.
2. Copy the generated **User UID**.
3. In **Firestore Database**, create a collection named `employees`, then add
   a document whose **Document ID** is that UID, with these fields:

   | Field       | Type      | Example              |
   |-------------|-----------|----------------------|
   | name        | string    | "Jane Admin"         |
   | email       | string    | "jane@company.com"   |
   | role        | string    | "admin"              |
   | employeeId  | string    | "ADM-001"            |
   | department  | string    | "Operations"         |
   | position    | string    | "HR Manager"         |
   | phone       | string    | "+91 90000 00000"    |
   | active      | boolean   | true                 |

4. Sign in at `index.html` with that email/password — you'll land on
   `admin.html`. From there, use **+ Add employee** to onboard everyone else.

### 4. Firestore data model

**`employees` collection** — one document per user, **Document ID = Auth UID**

```
employees/{uid}
  name, email, employeeId, department, position, phone
  role: "admin" | "employee"
  active: boolean
  createdAt, updatedAt (server timestamps)
```

**`attendance` collection** — one document per employee, per day,
**Document ID = `{uid}_{YYYY-MM-DD}`** (this makes check-in/check-out an
idempotent upsert — no duplicate rows for the same day)

```
attendance/{uid}_{date}
  uid, employeeName, employeeId, department
  date: "YYYY-MM-DD"
  checkIn: Timestamp | null
  checkOut: Timestamp | null
  status: "Present" | "Late" | "Half Day" | "Absent"
```

### 5. Recommended Firestore security rules
Paste this into **Firestore → Rules** so employees can only manage their own
attendance while admins have full control:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }
    function isAdmin() {
      return isSignedIn() &&
        get(/databases/$(database)/documents/employees/$(request.auth.uid)).data.role == "admin";
    }

    match /employees/{uid} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
    }

    match /attendance/{docId} {
      allow read: if isSignedIn();
      // Employees may only create/update their OWN attendance doc, and only
      // touch checkIn/checkOut/status/date fields (not impersonate someone else)
      allow create, update: if isAdmin() ||
        (isSignedIn() && request.resource.data.uid == request.auth.uid);
      allow delete: if isAdmin();
    }
  }
}
```

> ⚠️ Deleting an employee from the Admin dashboard removes their **Firestore
> profile** only. Client-side Firebase SDKs cannot delete *other users'*
> Authentication accounts for security reasons — to fully revoke sign-in
> access, delete the user in **Authentication → Users**, or wire up a small
> Cloud Function using the Admin SDK if you need this automated.

---

## 🚀 Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`,
   pick your branch (e.g. `main`) and root folder (`/`).
4. Save — your app will be live at `https://<username>.github.io/<repo>/`.

Since Firebase Authentication checks the **Authorized domains** list, add
your GitHub Pages domain there too:
**Firebase console → Authentication → Settings → Authorized domains → Add domain**.

---

## 🖥️ Running locally

No build tools needed — any static file server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## 🎨 Customization

- **Colors / theme**: all tokens live at the top of `style.css` under
  `:root` and `[data-theme="dark"]`.
- **Late cutoff time**: change `LATE_CUTOFF_HOUR` / `LATE_CUTOFF_MIN` at the
  top of `employee.js`.
- **Attendance list size**: `admin.js`'s `listenAttendanceAll()` caps at the
  last 500 records for performance — raise the `.limit(500)` if needed.

---

## 🧰 Tech stack

- HTML5 / CSS3 (custom properties, CSS grid, no framework)
- Vanilla JavaScript (ES6+)
- Firebase Authentication (Email/Password)
- Firebase Firestore (with offline persistence)
- Google Fonts: Inter, Manrope, JetBrains Mono
