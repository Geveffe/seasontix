// js/dashboard.js — user-facing ticket claiming dashboard

import { auth, db } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, query, where, orderBy,
  runTransaction, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  requireAuth, formatDate, formatDateShort,
  showToast, showConfirm, escapeHtml, TICKET_SETS,
} from './common.js';

let currentUser    = null;
let currentProfile = null;
let selectedEvent  = null;
const eventsCache  = {};

requireAuth(async (user, profile) => {
  currentUser    = user;
  currentProfile = profile;

  // Header
  document.getElementById('userName').textContent    = profile?.displayName || user.email;
  document.getElementById('userInitial').textContent = (profile?.displayName || user.email)[0].toUpperCase();
  if (profile?.role === 'admin') {
    document.getElementById('adminLink').classList.remove('hidden');
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });

  // Pending users see a waiting message instead of the dashboard content
  const approved = profile?.role === 'admin' || profile?.status === 'approved';
  if (!approved) {
    document.getElementById('pendingNotice').classList.remove('hidden');
    document.getElementById('mainContent').classList.add('hidden');
    return;
  }

  setupTabs();
  loadEvents();
  loadMyClaims();
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

// ---- Events -----------------------------------------------------
function loadEvents() {
  const container = document.getElementById('eventsContainer');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading games…</div>';

  const q = query(collection(db, 'events'), orderBy('date', 'asc'));

  onSnapshot(q, (snap) => {
    const now    = new Date();
    // Keep cache in sync
    snap.docs.forEach(d => { eventsCache[d.id] = { id: d.id, ...d.data() }; });

    const events = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => !e.date || e.date.toDate() >= now);

    if (events.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎟️</div>
          <p>No upcoming games yet — check back soon!</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'events-grid';
    events.forEach(ev => grid.appendChild(buildEventCard(ev)));
    container.appendChild(grid);
  }, (err) => {
    container.innerHTML = `<div class="empty-state"><p>Error loading games: ${escapeHtml(err.message)}</p></div>`;
  });
}

function buildEventCard(ev) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const anyAvail = Object.values(ev.ticketSets || {}).some(s => s.available);

  const setsHtml = Object.entries(TICKET_SETS).map(([key, label]) => {
    const avail = ev.ticketSets?.[key]?.available;
    const price = ev.ticketSets?.[key]?.price;
    const priceStr = price != null ? `<span style="font-size:12px;color:var(--text-muted);margin-right:6px">$${Number(price).toFixed(2)}</span>` : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
        <span>${escapeHtml(label)}</span>
        <div style="display:flex;align-items:center;flex-shrink:0">
          ${priceStr}
          <span class="badge ${avail ? 'badge-available' : 'badge-full'}">${avail ? 'Open' : 'Taken'}</span>
        </div>
      </div>`;
  }).join('');

  card.innerHTML = `
    <div class="event-card-header">
      <div class="event-date">${formatDate(ev.date)}</div>
      <div class="event-title">Seahawks vs. ${escapeHtml(ev.title)}</div>
    </div>
    <div class="event-card-body">
      <div style="display:flex;flex-direction:column;gap:8px">${setsHtml}</div>
    </div>
    <div class="event-card-footer">
      <button class="btn btn-primary" ${anyAvail ? '' : 'disabled'}
        onclick="openClaimModal('${escapeHtml(ev.id)}')">
        ${anyAvail ? 'Claim Tickets' : 'All Sets Taken'}
      </button>
    </div>`;
  return card;
}

// ---- My Claims --------------------------------------------------
function loadMyClaims() {
  const container = document.getElementById('claimsContainer');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading your claims…</div>';

  const q = query(collection(db, 'claims'), where('userId', '==', currentUser.uid));

  onSnapshot(q, async (snap) => {
    if (snap.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🪑</div>
          <p>You haven't claimed any tickets yet.</p>
        </div>`;
      return;
    }

    // Enrich with event data, then sort newest first
    const claims = await Promise.all(snap.docs.map(async d => {
      const claim = { id: d.id, ...d.data() };
      if (claim.eventId) {
        const evSnap = await getDoc(doc(db, 'events', claim.eventId));
        claim.event  = evSnap.exists() ? evSnap.data() : null;
      }
      return claim;
    }));
    claims.sort((a, b) => (b.claimedAt?.seconds || 0) - (a.claimedAt?.seconds || 0));

    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'claims-list';

    claims.forEach(claim => {
      const item       = document.createElement('div');
      item.className   = 'claim-item';
      const { status } = claim;
      const eventTitle = claim.event?.title || 'Unknown Event';

      const setsHtml = (claim.sets || [])
        .map(k => `<div style="font-size:13px;color:var(--text-muted)">${escapeHtml(TICKET_SETS[k] || k)}</div>`)
        .join('');

      const badgeClass  = { claimed: 'badge-confirmed', transferred: 'badge-admin', released: 'badge-released' }[status] || 'badge-confirmed';
      const badgeLabel  = { claimed: 'Claimed', transferred: 'Transferred', released: 'Released' }[status] || status;

      item.innerHTML = `
        <div class="claim-info">
          <div class="claim-title">Seahawks vs. ${escapeHtml(eventTitle)}</div>
          <div class="claim-meta">${formatDate(claim.event?.date)}</div>
          ${setsHtml}
        </div>
        <div class="claim-actions">
          <span class="badge ${badgeClass}">${badgeLabel}</span>
          ${status === 'claimed' ? `
            <button class="btn btn-ghost btn-sm"
              onclick="releaseClaim('${claim.id}', '${claim.eventId}')">
              Release
            </button>` : ''}
        </div>`;
      list.appendChild(item);
    });

    container.appendChild(list);
  });
}

// ---- Claim Modal ------------------------------------------------
window.openClaimModal = function(eventId) {
  const ev = eventsCache[eventId];
  if (!ev) return;
  selectedEvent = ev;

  document.getElementById('claimEventTitle').textContent = `Seahawks vs. ${ev.title}`;
  document.getElementById('claimError').classList.add('hidden');

  const container = document.getElementById('claimSetsContainer');
  container.innerHTML = Object.entries(TICKET_SETS).map(([key, label]) => {
    const avail = ev.ticketSets?.[key]?.available;
    if (!avail) return '';   // don't show already-taken sets
    return `
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:2px solid var(--border);border-radius:var(--radius-sm);transition:var(--transition)"
             onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'var(--primary)':'var(--border)'">
        <input type="checkbox" id="claimSet_${key}" value="${key}" style="width:16px;height:16px;cursor:pointer">
        <span style="font-size:14px">${escapeHtml(label)}</span>
      </label>`;
  }).join('');

  document.getElementById('claimModal').classList.remove('hidden');
};

window.closeClaimModal = function() {
  document.getElementById('claimModal').classList.add('hidden');
  selectedEvent = null;
};

document.getElementById('claimModal').addEventListener('click', (e) => {
  if (e.target.id === 'claimModal') window.closeClaimModal();
});

document.getElementById('submitClaim').addEventListener('click', async () => {
  if (!selectedEvent) return;

  const errEl      = document.getElementById('claimError');
  const selectedSets = Object.keys(TICKET_SETS)
    .filter(key => document.getElementById(`claimSet_${key}`)?.checked);

  if (selectedSets.length === 0) {
    errEl.textContent = 'Please select at least one ticket set.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn       = document.getElementById('submitClaim');
  btn.disabled    = true;
  btn.textContent = 'Claiming…';

  try {
    await runTransaction(db, async (tx) => {
      const eventRef = doc(db, 'events', selectedEvent.id);
      const eventDoc = await tx.get(eventRef);
      if (!eventDoc.exists()) throw new Error('Event not found.');

      // Verify each requested set is still available
      const data = eventDoc.data();
      for (const key of selectedSets) {
        if (!data.ticketSets?.[key]?.available) {
          throw new Error(`${TICKET_SETS[key]} was just taken. Please refresh and try again.`);
        }
      }

      // Mark sets unavailable
      const updates = {};
      selectedSets.forEach(k => { updates[`ticketSets.${k}.available`] = false; });
      tx.update(eventRef, updates);

      // Create the claim
      const claimRef = doc(collection(db, 'claims'));
      tx.set(claimRef, {
        userId:          currentUser.uid,
        userEmail:       currentUser.email,
        userDisplayName: currentProfile?.displayName || currentUser.email,
        eventId:         selectedEvent.id,
        eventTitle:      selectedEvent.title,
        sets:            selectedSets,
        status:          'claimed',
        claimedAt:       serverTimestamp(),
      });
    });

    window.closeClaimModal();
    showToast(`${selectedSets.length} set${selectedSets.length !== 1 ? 's' : ''} claimed! See "My Claims".`, 'success');
  } catch (err) {
    errEl.textContent = err.message || 'Failed to claim. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Confirm Claim';
  }
});

// ---- Release ----------------------------------------------------
window.releaseClaim = async function(claimId, eventId) {
  const ok = await showConfirm(
    'Release these tickets? They will become available for others and cannot be undone.',
    'Release Tickets'
  );
  if (!ok) return;

  try {
    await runTransaction(db, async (tx) => {
      const claimRef = doc(db, 'claims', claimId);
      const eventRef = doc(db, 'events', eventId);
      const [claimDoc, eventDoc] = await Promise.all([tx.get(claimRef), tx.get(eventRef)]);

      if (!claimDoc.exists())                          throw new Error('Claim not found.');
      if (claimDoc.data().status !== 'claimed')        throw new Error('These tickets can no longer be released.');

      const sets = claimDoc.data().sets || [];
      tx.update(claimRef, { status: 'released', releasedAt: serverTimestamp() });
      if (eventDoc.exists() && sets.length > 0) {
        const updates = {};
        sets.forEach(s => { updates[`ticketSets.${s}.available`] = true; });
        tx.update(eventRef, updates);
      }
    });
    showToast('Tickets released successfully.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to release tickets.', 'error');
  }
};
