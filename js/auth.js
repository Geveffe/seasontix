// js/auth.js — login / signup page logic

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Flag prevents onAuthStateChanged from redirecting mid-Google-flow
// while we're still writing the new user's Firestore document.
let googleSignInInProgress = false;

// Already logged in → go to dashboard
onAuthStateChanged(auth, (user) => {
  if (user && !googleSignInInProgress) window.location.href = 'dashboard.html';
});

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
    'auth/popup-blocked':         'Popup was blocked. Please allow popups for this site.',
    'auth/account-exists-with-different-credential':
                                  'An account already exists with this email using a different sign-in method.',
  }[code] || 'Something went wrong. Please try again.';
}

// ---- Google Sign-In ----
async function handleGoogleSignIn(errorId) {
  hideError(errorId);
  const provider = new GoogleAuthProvider();
  googleSignInInProgress = true;
  try {
    const cred = await signInWithPopup(auth, provider);
    // Create Firestore profile for first-time Google users
    const userRef = doc(db, 'users', cred.user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email:       cred.user.email,
        displayName: cred.user.displayName || cred.user.email,
        role:        'user',
        createdAt:   serverTimestamp(),
      });
    }
    window.location.href = 'dashboard.html';
  } catch (err) {
    googleSignInInProgress = false;
    // Silently ignore user-dismissed popups
    if (err.code !== 'auth/popup-closed-by-user' &&
        err.code !== 'auth/cancelled-popup-request') {
      showError(errorId, friendlyError(err.code));
    }
  }
}

document.getElementById('googleLoginBtn').addEventListener('click',  () => handleGoogleSignIn('loginError'));
document.getElementById('googleSignupBtn').addEventListener('click', () => handleGoogleSignIn('signupError'));

// ---- Login ----
document.getElementById('loginBtn').addEventListener('click', async () => {
  hideError('loginError');
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) { showError('loginError', 'Please fill in all fields.'); return; }

  setLoading('loginBtn', true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles the redirect
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
      role: 'user',
      createdAt: serverTimestamp(),
    });
    // onAuthStateChanged handles the redirect
  } catch (err) {
    setLoading('signupBtn', false);
    showError('signupError', friendlyError(err.code));
  }
});
