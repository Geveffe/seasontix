# Season Tix

A private ticket-claiming site for sharing season tickets with friends.  
Hosted on **GitHub Pages** · Backed by **Firebase** (Auth + Firestore).

---

## Quick Setup (do this once)

### 1 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Give it a name (e.g. `season-tix`), disable Google Analytics if you don't need it, then click **Create**.

### 2 — Enable Firebase Authentication

1. In the Firebase console, go to **Build → Authentication**.
2. Click **Get started** then choose the **Email/Password** provider and enable it. Save.

### 3 — Create a Firestore database

1. Go to **Build → Firestore Database** and click **Create database**.
2. Choose **Start in production mode** — you'll deploy real security rules in step 5.
3. Pick any region and click **Enable**.

### 4 — Register a web app & get your config

1. Go to **Project Settings** (gear icon) → **Your apps** → click the **</>** (Web) button.
2. Give it a nickname (e.g. `Season Tix Web`). Do **not** enable Firebase Hosting.
3. Copy the `firebaseConfig` object shown. It looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...:web:abc..."
};
```

4. Paste those values into **`js/firebase-config.js`**, replacing every `YOUR_*` placeholder.

> **Note on API keys:** Firebase web API keys are safe to commit to a public repo. They identify
> your project but grant no special access — security is enforced by Firestore rules, not the key.

### 5 — Deploy Firestore security rules

**Option A — Firebase CLI (recommended)**

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # choose your project, accept the default rules file
# When prompted for the rules file path, enter: firestore.rules
firebase deploy --only firestore:rules
```

**Option B — Firebase console**

1. Go to **Firestore → Rules** tab.
2. Copy the contents of `firestore.rules` from this repo and paste it in. Click **Publish**.

### 6 — Enable the required Firestore index

The claims query (user's own claims, sorted by date) needs one composite index.
When you first open **My Claims**, Firestore will show an error in the browser console with a direct link to create the index automatically — just click it and wait ~60 seconds.

Alternatively, create it manually:
- Collection: `claims`
- Fields: `userId` (Ascending), `claimedAt` (Descending)

### 7 — Push to GitHub & enable Pages

```bash
cd /path/to/seasontix
git init
git add .
git commit -m "Initial Season Tix site"
git remote add origin https://github.com/YOUR_USERNAME/seasontix.git
git push -u origin main
```

Then in the GitHub repo: **Settings → Pages → Source → Deploy from branch → main → / (root)**.

Your site will be live at: `https://YOUR_USERNAME.github.io/seasontix/`

### 8 — Create your admin account

1. Navigate to `https://YOUR_USERNAME.github.io/seasontix/setup.html`
2. Fill in your name, email, and a strong password — this becomes the admin account.
3. The page locks itself after the first submission so no one else can run setup.
4. Sign in at the normal login page.

---

## How it works

| Who         | What they can do |
|-------------|-----------------|
| **Admin**   | Add/edit/delete events · manage seat counts · view & cancel any claim · promote/demote members |
| **Member**  | View upcoming games · claim seats (atomic transaction prevents over-booking) · release their own claims |

### Claiming seats

Seat claims use a **Firestore transaction** so two people can't accidentally take the last seat at the same time.

### Releasing seats

Members can release their own confirmed claims from the **My Claims** tab; released seats are immediately returned to the event's available pool. Admins can cancel any claim from the Claims table.

---

## Local development

ES modules require a real HTTP server (browsers block `file://` imports).

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .

# VS Code
# Install the "Live Server" extension and click "Go Live"
```

Then open `http://localhost:8000`.

---

## File structure

```
seasontix/
├── index.html          # Login / signup
├── dashboard.html      # Member ticket dashboard
├── admin.html          # Admin panel
├── setup.html          # First-time admin setup (run once)
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js   ← fill in YOUR config here
│   ├── common.js
│   ├── auth.js
│   ├── setup.js
│   ├── dashboard.js
│   └── admin.js
└── firestore.rules
```
