// js/common.js — shared utilities

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc }        from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ---- Auth guards ------------------------------------------------

export function requireAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    const profile = await getUserProfile(user.uid);
    callback(user, profile);
  });
}

export function requireAdmin(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    const profile = await getUserProfile(user.uid);
    if (profile?.role !== 'admin') { window.location.href = 'dashboard.html'; return; }
    callback(user, profile);
  });
}

// ---- Firestore helpers -----------------------------------------

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---- Date helpers ----------------------------------------------

export function formatDate(timestamp) {
  if (!timestamp) return 'TBD';
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function formatDateShort(timestamp) {
  if (!timestamp) return 'TBD';
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---- String utils -----------------------------------------------

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- Toast notifications ----------------------------------------

let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

export function showToast(message, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
  getToastContainer().appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3500);
}

// ---- Confirm dialog ---------------------------------------------

export function showConfirm(message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-body" style="padding:28px 24px 20px">
          <p style="font-size:15px;font-weight:700;margin-bottom:8px">Are you sure?</p>
          <p style="font-size:14px;color:var(--text-muted)">${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="_cNo">Cancel</button>
          <button class="btn btn-danger" id="_cYes">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_cNo').onclick  = () => done(false);
    overlay.querySelector('#_cYes').onclick = () => done(true);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
  });
}

// ---- Ticket set definitions ------------------------------------

export const TICKET_SETS = {
  s130m57:    'Sec 130 · Row M · Seats 5–7',
  s149bb1213: 'Sec 149 · Row BB · Seats 12–13',
  s149bb1415: 'Sec 149 · Row BB · Seats 14–15',
};
