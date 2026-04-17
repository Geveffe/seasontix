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
    'auth/account-exists-with-different-credential':
                                  'An account already exists with this email using a different sign-in method.',
  }[code] || 'Something went wrong. Please try again.';
}

// ---- Auth redirect coordination ----
// getRedirectResult is kicked off immediately and stored as a promise so the
// onAuthStateChanged listener can await it before deciding to redirect. This
// ensures that (a) the listener is always registered (so email/password login
// redirects work), and (b) a new Google user's Firestore profile is written
// before any redirect fires.
const redirectCheck = getRedirectResult(auth)
  .then(async (result) => {
    if (!result) return;
    const userRef  = doc(db, 'users', result.user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email:       result.user.email,
        displayName: result.user.displayName || result.user.email,
        role:        'user',
        status:      'pending',
        createdAt:   serverTimestamp(),
      });
    }
    window.location.href = 'dashboard.html';
  })
  .catch((err) => {
    if (err.code !== 'auth/user-cancelled') {
      showError('loginError', friendlyError(err.code));
    }
  });

onAuthStateChanged(auth, async (user) => {
  await redirectCheck; // let the Google redirect flow finish first if in progress
  if (user) window.location.href = 'dashboard.html';
});

// ---- Google Sign-In ----
function handleGoogleSignIn() {
  signInWithRedirect(auth, new GoogleAuthProvider());
  // Browser navigates away; result is handled by init() on return.
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
      role:        'user',
      status:      'pending',
      createdAt:   serverTimestamp(),
    });
    // onAuthStateChanged handles the redirect
  } catch (err) {
    setLoading('signupBtn', false);
    showError('signupError', friendlyError(err.code));
  }
});
