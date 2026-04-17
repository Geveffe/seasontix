// js/auth.js — login / signup page logic

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ---- Form toggling ----
const loginForm  = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');

document.getElementById('showSignup').addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.classList.add('hidden');
  signupForm.classList.remove('hidden');
  document.getElementById('signupName').focus();
});

document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  signupForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  document.getElementById('loginEmail').focus();
});

// ---- Helpers ----
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError(id) { document.getElementById(id).classList.add('hidden'); }

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

document.getElementById('loginBtn').dataset.label  = 'Sign In';
document.getElementById('signupBtn').dataset.label = 'Create Account';

function friendlyError(code) {
  return {
    'auth/user-not-found':        'No account found with this email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-credential':    'Invalid email or password.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/email-already-in-use':  'An account with this email already exists.',
    'auth/weak-password':         'Password must be at least 8 characters.',
    'auth/too-many-requests':     'Too many attempts — please try again later.',
    'auth/network-request-failed':'Network error. Check your connection.',
    'auth/unauthorized-domain':   'This domain is not authorized for sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.',
    'auth/account-exists-with-different-credential':
                                  'An account already exists with this email using a different sign-in method.',
  }[code] || `Something went wrong (${code || 'unknown'}). Please try again.`;
}

// ---- Auth state (already-signed-in redirect + redirect-flow return) ----
// On return from a Google redirect, getRedirectResult fires before
// onAuthStateChanged and handles the navigation itself.
const googleRedirectPending = Boolean(sessionStorage.getItem('googleRedirect'));
sessionStorage.removeItem('googleRedirect');

async function ensureProfile(user) {
  const userRef  = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email:       user.email,
      displayName: user.displayName || user.email,
      role:        'user',
      status:      'pending',
      createdAt:   serverTimestamp(),
    });
  }
}

if (googleRedirectPending) {
  // Returning from a Google redirect — pick up the result.
  getRedirectResult(auth)
    .then(async (result) => {
      if (result) {
        await ensureProfile(result.user);
        window.location.href = 'dashboard.html';
      } else {
        // Result already consumed or redirect didn't complete — check auth state.
        onAuthStateChanged(auth, (user) => { if (user) window.location.href = 'dashboard.html'; });
      }
    })
    .catch((err) => {
      // Show the real error code so we can diagnose domain/config issues.
      showError('loginError', friendlyError(err.code));
      onAuthStateChanged(auth, (user) => { if (user) window.location.href = 'dashboard.html'; });
    });
} else {
  // Normal page load — redirect already-signed-in users.
  onAuthStateChanged(auth, (user) => { if (user) window.location.href = 'dashboard.html'; });
}

// ---- Google Sign-In ----
// Try popup first (no domain config needed). If the browser blocks the popup,
// fall back to the redirect flow automatically.
async function handleGoogleSignIn() {
  hideError('loginError');
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    await ensureProfile(result.user);
    window.location.href = 'dashboard.html';
  } catch (err) {
    if (err.code === 'auth/popup-blocked') {
      sessionStorage.setItem('googleRedirect', '1');
      signInWithRedirect(auth, new GoogleAuthProvider());
    } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showError('loginError', friendlyError(err.code));
    }
  }
}

document.getElementById('googleLoginBtn').addEventListener('click',  handleGoogleSignIn);
document.getElementById('googleSignupBtn').addEventListener('click', handleGoogleSignIn);

// ---- Login ----
document.getElementById('loginBtn').addEventListener('click', async () => {
  hideError('loginError');
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) { showError('loginError', 'Please fill in all fields.'); return; }

  setLoading('loginBtn', true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = 'dashboard.html';
  } catch (err) {
    setLoading('loginBtn', false);
    showError('loginError', friendlyError(err.code));
  }
});

['loginEmail', 'loginPassword'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
});

// ---- Signup ----
document.getElementById('signupBtn').addEventListener('click', async () => {
  hideError('signupError');
  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm  = document.getElementById('signupConfirm').value;

  if (!name || !email || !password || !confirm) {
    showError('signupError', 'Please fill in all fields.'); return;
  }
  if (password.length < 8) {
    showError('signupError', 'Password must be at least 8 characters.'); return;
  }
  if (password !== confirm) {
    showError('signupError', 'Passwords do not match.'); return;
  }

  setLoading('signupBtn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      email,
      displayName: name,
      role:        'user',
      status:      'pending',
      createdAt:   serverTimestamp(),
    });
    window.location.href = 'dashboard.html';
  } catch (err) {
    setLoading('signupBtn', false);
    showError('signupError', friendlyError(err.code));
  }
});
