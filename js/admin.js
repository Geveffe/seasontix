// js/admin.js — admin panel logic

import { auth, db } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, runTransaction, onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  requireAdmin, formatDate, formatDateShort,
  showToast, showConfirm, escapeHtml, TICKET_SETS,
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
  loadCodes();
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
    const events = snap.docs.map(d => d.data());
    let availSets = 0;
    events.forEach(e => Object.values(e.ticketSets || {}).forEach(s => { if (s.available) availSets++; }));
    document.getElementById('statEvents').textContent     = events.length;
    document.getElementById('statAvailSeats').textContent = availSets;
  });
  onSnapshot(collection(db, 'users'), (snap) => {
    const users   = snap.docs.map(d => d.data());
    const pending = users.filter(u => u.role !== 'admin' && u.status !== 'approved').length;
    document.getElementById('statUsers').textContent   = snap.size;
    document.getElementById('statPending').textContent = pending;
    const badge = document.getElementById('pendingBadge');
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
  onSnapshot(collection(db, 'claims'), (snap) => {
    const active = snap.docs.filter(d => !['released'].includes(d.data().status)).length;
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
  const tr = document.createElement('tr');
  const setsHtml = Object.entries(TICKET_SETS).map(([key, label]) => {
    const avail  = ev.ticketSets?.[key]?.available;
    const price  = ev.ticketSets?.[key]?.price;
    const short  = label.split('·').pop().trim();
    const priceStr = price != null ? ` · $${Number(price).toFixed(2)}` : '';
    return `<div style="display:flex;align-items:center;gap:5px;margin:2px 0">
      <span class="badge ${avail ? 'badge-available' : 'badge-full'}">${escapeHtml(short)}</span>
      ${priceStr ? `<span style="font-size:12px;color:var(--text-muted)">${priceStr}</span>` : ''}
    </div>`;
  }).join('');
  tr.innerHTML = `
    <td><strong>vs. ${escapeHtml(ev.title)}</strong></td>
    <td>${formatDate(ev.date)}</td>
    <td>${setsHtml}</td>
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
  document.getElementById('evTitle').value = ev.title || '';
  document.getElementById('evDate').value  = ev.date ? toDatetimeLocal(ev.date.toDate()) : '';

  Object.keys(TICKET_SETS).forEach(key => {
    document.getElementById(`set_${key}`).checked     = ev.ticketSets?.[key]?.available ?? false;
    const price = ev.ticketSets?.[key]?.price;
    document.getElementById(`price_${key}`).value     = price != null ? price : '';
  });

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

window.submitEvent = async function() {
  const errEl = document.getElementById('eventError');
  errEl.classList.add('hidden');

  const title   = document.getElementById('evTitle').value.trim();
  const dateStr = document.getElementById('evDate').value;

  if (!title) {
    errEl.textContent = 'Opponent is required.';
    errEl.classList.remove('hidden');
    return;
  }

  const ticketSets = {};
  Object.keys(TICKET_SETS).forEach(key => {
    const priceVal = parseFloat(document.getElementById(`price_${key}`).value);
    ticketSets[key] = {
      available: document.getElementById(`set_${key}`).checked,
      price: isNaN(priceVal) ? null : priceVal,
    };
  });

  const btn = document.getElementById('submitEvent');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const data = {
    title,
    date:      dateStr ? Timestamp.fromDate(new Date(dateStr)) : null,
    ticketSets,
    updatedAt: serverTimestamp(),
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
  const tr        = document.createElement('tr');
  const isAdmin   = u.role === 'admin';
  const approved  = isAdmin || u.status === 'approved';
  const statusLabel = isAdmin ? '—' : (approved ? 'Approved' : 'Pending');
  const statusBadge = isAdmin ? '—'
    : `<span class="badge ${approved ? 'badge-confirmed' : 'badge-released'}">${statusLabel}</span>`;

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
    <td>${statusBadge}</td>
    <td>${u.createdAt ? formatDateShort(u.createdAt) : '—'}</td>
    <td>
      <div style="display:flex;gap:6px">
        ${!isAdmin ? `
          <button class="btn btn-${approved ? 'ghost' : 'success'} btn-sm"
            onclick="${approved ? 'revokeApproval' : 'approveUser'}('${u.id}', '${escapeHtml(u.displayName || u.email)}')">
            ${approved ? 'Revoke' : 'Approve'}
          </button>` : ''}
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

window.approveUser = async function(userId, name) {
  try {
    await updateDoc(doc(db, 'users', userId), { status: 'approved' });
    showToast(`${name} approved — they can now access the dashboard.`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to approve user.', 'error');
  }
};

window.revokeApproval = async function(userId, name) {
  const ok = await showConfirm(`Revoke access for ${name}? They will see the pending screen until re-approved.`, 'Revoke');
  if (!ok) return;
  try {
    await updateDoc(doc(db, 'users', userId), { status: 'pending' });
    showToast(`${name}'s access revoked.`, 'info');
  } catch (err) {
    showToast(err.message || 'Failed to revoke access.', 'error');
  }
};

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
  const tr = document.createElement('tr');
  const { status } = c;
  const setsHtml   = (c.sets || []).map(k => escapeHtml(TICKET_SETS[k] || k)).join('<br>');
  const badgeClass = { claimed: 'badge-confirmed', transferred: 'badge-admin', released: 'badge-released' }[status] || 'badge-confirmed';
  const badgeLabel = { claimed: 'Claimed', transferred: 'Transferred', released: 'Released' }[status] || status;
  const isActive   = status === 'claimed' || status === 'transferred';

  tr.innerHTML = `
    <td>${escapeHtml(c.userDisplayName || c.userEmail || '—')}</td>
    <td>vs. ${escapeHtml(c.eventTitle || '—')}</td>
    <td>${c.claimedAt ? formatDateShort(c.claimedAt) : '—'}</td>
    <td style="font-size:13px">${setsHtml || '—'}</td>
    <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
    <td>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${status === 'claimed' ? `
          <button class="btn btn-accent btn-sm"
            onclick="markTransferred('${c.id}', '${escapeHtml(c.userDisplayName || '')}')">
            Mark Transferred
          </button>` : ''}
        ${isActive ? `
          <button class="btn btn-ghost btn-sm"
            onclick="adminCancelClaim('${c.id}', '${c.eventId}', '${escapeHtml(c.userDisplayName || '')}')">
            Cancel
          </button>` : '—'}
      </div>
    </td>`;
  return tr;
}

window.markTransferred = async function(claimId, userName) {
  const ok = await showConfirm(`Mark ${userName}'s tickets as Transferred? The claim will be locked and they won't be able to release it.`, 'Mark Transferred');
  if (!ok) return;
  try {
    await updateDoc(doc(db, 'claims', claimId), { status: 'transferred', transferredAt: serverTimestamp() });
    showToast(`Tickets marked as transferred.`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to update claim.', 'error');
  }
};

window.adminCancelClaim = async function(claimId, eventId, userName) {
  const ok = await showConfirm(`Cancel ${userName}'s claim? Ticket sets will be returned to available.`, 'Cancel Claim');
  if (!ok) return;

  try {
    await runTransaction(db, async (tx) => {
      const claimRef = doc(db, 'claims', claimId);
      const eventRef = doc(db, 'events', eventId);
      const [claimDoc, eventDoc] = await Promise.all([tx.get(claimRef), tx.get(eventRef)]);

      if (!claimDoc.exists()) throw new Error('Claim not found.');
      if (claimDoc.data().status === 'released') throw new Error('Already released.');
      const sets = claimDoc.data().sets || [];
      tx.update(claimRef, { status: 'released', releasedAt: serverTimestamp(), releasedByAdmin: true });
      if (eventDoc.exists() && sets.length > 0) {
        const updates = {};
        sets.forEach(s => { updates[`ticketSets.${s}.available`] = true; });
        tx.update(eventRef, updates);
      }
    });
    showToast('Claim cancelled and sets returned.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to cancel claim.', 'error');
  }
};

// ---- Codes Tab --------------------------------------------------
function loadCodes() {
  const tbody = document.getElementById('codesBody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading" style="text-align:center;padding:32px"><div class="spinner" style="margin:auto"></div></td></tr>';

  onSnapshot(collection(db, 'inviteCodes'), (snap) => {
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted)">No invite codes yet. Generate one to invite a new user.</td></tr>';
      return;
    }
    const codes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    tbody.innerHTML = '';
    codes.forEach(c => tbody.appendChild(buildCodeRow(c)));
  });
}

function buildCodeRow(c) {
  const tr     = document.createElement('tr');
  const isUsed = c.used;
  tr.innerHTML = `
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <code style="font-family:monospace;font-size:13px;letter-spacing:1px;background:var(--bg);padding:3px 7px;border-radius:4px;border:1px solid var(--border)">${escapeHtml(c.id)}</code>
        <button class="btn btn-ghost btn-sm" onclick="copyCode('${escapeHtml(c.id)}')">Copy</button>
      </div>
    </td>
    <td>${c.createdAt ? formatDateShort(c.createdAt) : '—'}</td>
    <td><span class="badge ${isUsed ? 'badge-released' : 'badge-available'}">${isUsed ? 'Used' : 'Available'}</span></td>
    <td style="font-size:13px">${isUsed ? escapeHtml(c.usedByEmail || '—') : '—'}</td>
    <td>
      ${!isUsed
        ? `<button class="btn btn-danger btn-sm" onclick="deleteCode('${escapeHtml(c.id)}')">Delete</button>`
        : '—'}
    </td>`;
  return tr;
}

window.generateCode = async function() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part  = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const code  = `HAWK-${part()}-${part()}`;
  try {
    await setDoc(doc(db, 'inviteCodes', code), {
      used: false,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
    });
    showToast(`Code "${code}" created — copy and share it.`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to generate code.', 'error');
  }
};

window.copyCode = function(code) {
  navigator.clipboard.writeText(code)
    .then(() => showToast(`"${code}" copied to clipboard.`, 'success'))
    .catch(() => showToast('Could not copy to clipboard.', 'error'));
};

window.deleteCode = async function(codeId) {
  const ok = await showConfirm(`Delete code "${codeId}"? It will no longer work for new users.`, 'Delete Code');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'inviteCodes', codeId));
    showToast('Code deleted.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to delete code.', 'error');
  }
};

// ---- Utils ------------------------------------------------------
function toDatetimeLocal(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
