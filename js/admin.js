// js/admin.js — admin panel logic

import { auth, db } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, runTransaction, onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  requireAdmin, formatDate, formatDateShort,
  showToast, showConfirm, escapeHtml, getSeatPct,
} from './common.js';

let currentUser    = null;
let editingEventId = null;   // null = adding, string = editing

requireAdmin(async (user, profile) => {
  currentUser = user;
  document.getElementById('userName').textContent    = profile?.displayName || user.email;
  document.getElementById('userInitial').textContent = (profile?.displayName || user.email)[0].toUpperCase();

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });

  setupTabs();
  loadStats();
  loadEvents();
  loadUsers();
  loadClaims();
});

// ---- Tabs -------------------------------------------------------
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
    });
  });
}

// ---- Stats ------------------------------------------------------
function loadStats() {
  onSnapshot(collection(db, 'events'), (snap) => {
    const events    = snap.docs.map(d => d.data());
    const totalEvt  = events.length;
    const totalSeats = events.reduce((s, e) => s + (e.availableSeats || 0), 0);
    document.getElementById('statEvents').textContent    = totalEvt;
    document.getElementById('statAvailSeats').textContent = totalSeats;
  });
  onSnapshot(collection(db, 'users'), (snap) => {
    document.getElementById('statUsers').textContent = snap.size;
  });
  onSnapshot(collection(db, 'claims'), (snap) => {
    const active = snap.docs.filter(d => d.data().status !== 'released').length;
    document.getElementById('statClaims').textContent = active;
  });
}

// ---- Events Tab -------------------------------------------------
let _eventsUnsub = null;

function loadEvents() {
  const tbody = document.getElementById('eventsBody');
  tbody.innerHTML = '<tr><td colspan="7" class="loading" style="text-align:center;padding:32px"><div class="spinner" style="margin:auto"></div></td></tr>';

  const q = query(collection(db, 'events'), orderBy('date', 'asc'));
  _eventsUnsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">No events yet. Add one!</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    snap.docs.forEach(d => tbody.appendChild(buildEventRow(d.id, d.data())));
  });
}

function buildEventRow(id, ev) {
  const tr        = document.createElement('tr');
  const avail     = ev.availableSeats ?? 0;
  const total     = ev.totalSeats     ?? 0;
  const pct       = getSeatPct(avail, total);
  const isFull    = avail <= 0;
  tr.innerHTML = `
    <td><strong>${escapeHtml(ev.title)}</strong></td>
    <td>${formatDate(ev.date)}</td>
    <td>${escapeHtml(ev.venue || '—')}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <span>${avail} / ${total}</span>
        <div class="seats-bar" style="width:60px">
          <div class="seats-fill ${isFull ? 'full' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
    </td>
    <td>${ev.deadline ? formatDateShort(ev.deadline) : '—'}</td>
    <td>${escapeHtml(ev.notes || '—')}</td>
    <td>
      <div style="display:flex;gap:6px">
        <button class="btn btn-outline btn-sm" onclick="openEditEventModal('${id}')">Edit</button>
        <button class="btn btn-danger  btn-sm" onclick="deleteEvent('${id}', '${escapeHtml(ev.title)}')">Delete</button>
      </div>
    </td>`;
  return tr;
}

// ---- Event Modal ------------------------------------------------
window.openAddEventModal = function() {
  editingEventId = null;
  document.getElementById('eventModalTitle').textContent = 'Add Event';
  document.getElementById('eventForm').reset();
  document.getElementById('eventError').classList.add('hidden');
  document.getElementById('eventModal').classList.remove('hidden');
};

window.openEditEventModal = async function(id) {
  editingEventId = id;
  const snap = await getDoc(doc(db, 'events', id));
  if (!snap.exists()) { showToast('Event not found.', 'error'); return; }
  const ev = snap.data();

  document.getElementById('eventModalTitle').textContent = 'Edit Event';
  document.getElementById('evTitle').value      = ev.title || '';
  document.getElementById('evVenue').value      = ev.venue || '';
  document.getElementById('evTotalSeats').value = ev.totalSeats || '';
  document.getElementById('evAvailSeats').value = ev.availableSeats ?? '';
  document.getElementById('evNotes').value      = ev.notes || '';

  if (ev.date) {
    document.getElementById('evDate').value = toDatetimeLocal(ev.date.toDate());
  }
  if (ev.deadline) {
    document.getElementById('evDeadline').value = toDatetimeLocal(ev.deadline.toDate());
  } else {
    document.getElementById('evDeadline').value = '';
  }

  document.getElementById('eventError').classList.add('hidden');
  document.getElementById('eventModal').classList.remove('hidden');
};

window.closeEventModal = function() {
  document.getElementById('eventModal').classList.add('hidden');
  editingEventId = null;
};

document.getElementById('eventModal').addEventListener('click', (e) => {
  if (e.target.id === 'eventModal') window.closeEventModal();
});

// Auto-fill available seats when total changes (add mode only)
document.getElementById('evTotalSeats').addEventListener('input', () => {
  if (!editingEventId) {
    document.getElementById('evAvailSeats').value = document.getElementById('evTotalSeats').value;
  }
});

window.submitEvent = async function() {
  const errEl = document.getElementById('eventError');
  errEl.classList.add('hidden');

  const title      = document.getElementById('evTitle').value.trim();
  const dateStr    = document.getElementById('evDate').value;
  const venue      = document.getElementById('evVenue').value.trim();
  const totalSeats = parseInt(document.getElementById('evTotalSeats').value);
  const availSeats = parseInt(document.getElementById('evAvailSeats').value);
  const deadlineStr = document.getElementById('evDeadline').value;
  const notes      = document.getElementById('evNotes').value.trim();

  if (!title || !dateStr || isNaN(totalSeats) || isNaN(availSeats)) {
    errEl.textContent = 'Title, date, and seat counts are required.';
    errEl.classList.remove('hidden');
    return;
  }
  if (availSeats > totalSeats) {
    errEl.textContent = 'Available seats cannot exceed total seats.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('submitEvent');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const data = {
    title,
    date:           Timestamp.fromDate(new Date(dateStr)),
    venue,
    totalSeats,
    availableSeats: availSeats,
    notes,
    deadline:       deadlineStr ? Timestamp.fromDate(new Date(deadlineStr)) : null,
    updatedAt:      serverTimestamp(),
  };

  try {
    if (editingEventId) {
      await updateDoc(doc(db, 'events', editingEventId), data);
      showToast('Event updated.', 'success');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'events'), data);
      showToast('Event added.', 'success');
    }
    window.closeEventModal();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to save event.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Event';
  }
};

window.deleteEvent = async function(id, title) {
  const ok = await showConfirm(`Delete "${title}"? All existing claims for this event will remain but the event listing will be removed.`, 'Delete');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'events', id));
    showToast('Event deleted.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to delete event.', 'error');
  }
};

// ---- Users Tab --------------------------------------------------
function loadUsers() {
  const tbody = document.getElementById('usersBody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading" style="text-align:center;padding:32px"><div class="spinner" style="margin:auto"></div></td></tr>';

  onSnapshot(collection(db, 'users'), (snap) => {
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted)">No users yet.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    users.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    users.forEach(u => tbody.appendChild(buildUserRow(u)));
  });
}

function buildUserRow(u) {
  const tr = document.createElement('tr');
  const isAdmin = u.role === 'admin';
  tr.innerHTML = `
    <td>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="user-avatar" style="width:32px;height:32px;font-size:12px;background:${isAdmin ? 'var(--accent)' : 'var(--primary)'}">
          ${escapeHtml((u.displayName || u.email)[0].toUpperCase())}
        </div>
        <strong>${escapeHtml(u.displayName || '—')}</strong>
      </div>
    </td>
    <td>${escapeHtml(u.email)}</td>
    <td><span class="badge badge-${isAdmin ? 'admin' : 'user'}">${isAdmin ? 'Admin' : 'Member'}</span></td>
    <td>${u.createdAt ? formatDateShort(u.createdAt) : '—'}</td>
    <td>
      <div style="display:flex;gap:6px">
        <button class="btn btn-outline btn-sm"
          onclick="toggleRole('${u.id}', '${u.role}', '${escapeHtml(u.displayName || u.email)}')">
          ${isAdmin ? 'Demote' : 'Make Admin'}
        </button>
        <button class="btn btn-danger btn-sm"
          onclick="deleteUser('${u.id}', '${escapeHtml(u.displayName || u.email)}')">
          Delete
        </button>
      </div>
    </td>`;
  return tr;
}

window.toggleRole = async function(userId, currentRole, name) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  const verb    = newRole === 'admin' ? 'promote to Admin' : 'demote to Member';
  const ok = await showConfirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${name}?`, 'Confirm');
  if (!ok) return;
  try {
    await updateDoc(doc(db, 'users', userId), { role: newRole });
    showToast(`${name} is now a${newRole === 'admin' ? 'n admin' : ' member'}.`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to update role.', 'error');
  }
};

window.deleteUser = async function(userId, name) {
  const ok = await showConfirm(`Delete user "${name}"? Their claims will remain but they won't be able to log in.`, 'Delete User');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'users', userId));
    showToast(`${name} removed.`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to delete user.', 'error');
  }
};

// ---- Claims Tab -------------------------------------------------
function loadClaims() {
  const tbody = document.getElementById('claimsBody');
  tbody.innerHTML = '<tr><td colspan="7" class="loading" style="text-align:center;padding:32px"><div class="spinner" style="margin:auto"></div></td></tr>';

  onSnapshot(collection(db, 'claims'), (snap) => {
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">No claims yet.</td></tr>';
      return;
    }
    const claims = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.claimedAt?.seconds || 0) - (a.claimedAt?.seconds || 0));

    tbody.innerHTML = '';
    claims.forEach(c => tbody.appendChild(buildClaimRow(c)));
  });
}

function buildClaimRow(c) {
  const tr       = document.createElement('tr');
  const released = c.status === 'released';
  tr.innerHTML = `
    <td>${escapeHtml(c.userDisplayName || c.userEmail || '—')}</td>
    <td>${escapeHtml(c.eventTitle || '—')}</td>
    <td>${c.claimedAt ? formatDateShort(c.claimedAt) : '—'}</td>
    <td>${c.seatCount}</td>
    <td>${escapeHtml(c.notes || '—')}</td>
    <td><span class="badge badge-${released ? 'released' : 'confirmed'}">${released ? 'Released' : 'Confirmed'}</span></td>
    <td>
      ${!released ? `
        <button class="btn btn-ghost btn-sm"
          onclick="adminCancelClaim('${c.id}', '${c.eventId}', ${c.seatCount}, '${escapeHtml(c.userDisplayName || '')}')">
          Cancel
        </button>` : '—'}
    </td>`;
  return tr;
}

window.adminCancelClaim = async function(claimId, eventId, seatCount, userName) {
  const ok = await showConfirm(`Cancel ${userName}'s claim of ${seatCount} seat${seatCount !== 1 ? 's' : ''}? Seats will be returned.`, 'Cancel Claim');
  if (!ok) return;

  try {
    await runTransaction(db, async (tx) => {
      const claimRef = doc(db, 'claims', claimId);
      const eventRef = doc(db, 'events', eventId);
      const [claimDoc, eventDoc] = await Promise.all([tx.get(claimRef), tx.get(eventRef)]);

      if (!claimDoc.exists()) throw new Error('Claim not found.');
      tx.update(claimRef, { status: 'released', releasedAt: serverTimestamp(), releasedByAdmin: true });
      if (eventDoc.exists()) {
        tx.update(eventRef, { availableSeats: (eventDoc.data().availableSeats || 0) + seatCount });
      }
    });
    showToast('Claim cancelled and seats returned.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to cancel claim.', 'error');
  }
};

// ---- Utils ------------------------------------------------------
function toDatetimeLocal(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
