// js/setup.js — first-time admin account creation

import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const setupSection = document.getElementById('setupSection');
const doneSection  = document.getElementById('doneSection');
const errorMsg     = document.getElementById('setupError');
const successMsg   = document.getElementById('setupSuccess');

// If setup already complete, show "done" view
async function init() {
  const snap = await getDoc(doc(db, 'config', 'setup'));
  if (snap.exists()) {
    setupSection.classList.add('hidden');
    doneSection.classList.remove('hidden');
  }
}
init();

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  successMsg.classList.add('hidden');
}
function showSuccess(msg) {
  successMsg.textContent = msg;
  successMsg.classList.remove('hidden');
  errorMsg.classList.add('hidden');
}

// ---- Google admin setup ----
document.getElementById('googleSetupBtn').addEventListener('click', async () => {
  errorMsg.classList.add('hidden');

  // Open the popup immediately — no awaits before this or the browser blocks it.
  const provider = new GoogleAuthProvider();
  let cred;
  try {
    cred = await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' &&
        err.code !== 'auth/cancelled-popup-request') {
      showError(`Google sign-in failed: ${err.code || err.message}`);
    }
    return;
  }

  const btn = document.getElementById('googleSetupBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account…';

  // Now safe to do async Firestore checks
  const existing = await getDoc(doc(db, 'config', 'setup'));
  if (existing.exists()) {
    showError('Setup has already been completed.');
    btn.disabled = false;
    btn.textContent = 'Create Admin Account with Google';
    return;
  }

  try {
    const userRef  = doc(db, 'users', cred.user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists() && userSnap.data().role !== 'admin') {
      showError('This Google account is already registered as a regular user. Please use a different account for admin setup.');
      btn.disabled = false;
      btn.textContent = 'Create Admin Account with Google';
      return;
    }

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email:       cred.user.email,
        displayName: cred.user.displayName || cred.user.email,
        role:        'admin',
        createdAt:   serverTimestamp(),
      });
    }

    await setDoc(doc(db, 'config', 'setup'), {
      completedAt: serverTimestamp(),
      adminUid:    cred.user.uid,
      adminEmail:  cred.user.email,
    });

    showSuccess('Admin account created! Redirecting to sign in…');
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Admin Account with Google';
    showError(err.message || 'Something went wrong.');
  }
});

// ---- Email admin setup ----
document.getElementById('setupBtn').addEventListener('click', async () => {
  errorMsg.classList.add('hidden');

  const name     = document.getElementById('setupName').value.trim();
  const email    = document.getElementById('setupEmail').value.trim();
  const password = document.getElementById('setupPassword').value;
  const confirm  = document.getElementById('setupConfirm').value;

  if (!name || !email || !password || !confirm) { showError('Please fill in all fields.'); return; }
  if (password.length < 8)                       { showError('Password must be at least 8 characters.'); return; }
  if (password !== confirm)                       { showError('Passwords do not match.'); return; }

  // Re-check that setup hasn't been completed by someone else
  const existing = await getDoc(doc(db, 'config', 'setup'));
  if (existing.exists()) { showError('Setup has already been completed.'); return; }

  const btn = document.getElementById('setupBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // Write admin user profile first (security rule checks this)
    await setDoc(doc(db, 'users', cred.user.uid), {
      email,
      displayName: name,
      role: 'admin',
      createdAt: serverTimestamp(),
    });

    // Mark setup complete (locks out future first-admin attempts)
    await setDoc(doc(db, 'config', 'setup'), {
      completedAt: serverTimestamp(),
      adminUid:    cred.user.uid,
      adminEmail:  email,
    });

    showSuccess('Admin account created! Redirecting to login…');
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Admin Account';
    const map = {
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/invalid-email':        'Please enter a valid email address.',
      'auth/weak-password':        'Password must be at least 8 characters.',
    };
    showError(map[err.code] || err.message || 'Something went wrong.');
  }
});
