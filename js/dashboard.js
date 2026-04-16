// js/dashboard.js — user-facing ticket claiming dashboard

import { auth, db } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, query, where, orderBy,
  runTransaction, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  requireAuth, formatDate, formatDateShort,
  showToast, showConfirm, escapeHtml, getSeatPct,
} from './common.js';

let currentUser    = null;
let currentProfile = null;
let selectedEvent  = null;

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
  const card      = document.createElement('div');
  card.className  = 'event-card';
  const avail     = ev.availableSeats ?? 0;
  const total     = ev.totalSeats     ?? 0;
  const pct       = getSeatPct(avail, total);
  const isFull    = avail <= 0;
  const deadlinePast = ev.deadline && ev.deadline.toDate() < new Date();

  const deadlineHtml = ev.deadline ? `
    <div class="deadline ${deadlineClass(ev.deadline)}">
      ⏰ Claim by ${formatDateShort(ev.deadline)}
    </div>` : '';

  card.innerHTML = `
    <div class="event-card-header">
      <div class="event-date">${formatDate(ev.date)}</div>
      <div class="event-title">${escapeHtml(ev.title)}</div>
      <div class="event-venue">${escapeHtml(ev.venue || '')}</div>
    </div>
    <div class="event-card-body">
      <div>
        <div class="seats-info">
          <div>
            <div class="seats-count">${avail}</div>
            <div class="seats-label">of ${total} seats available</div>
          </div>
          <span class="badge ${isFull ? 'badge-full' : 'badge-available'}">
            ${isFull ? 'Full' : 'Open'}
          </span>
        </div>
        <div class="seats-bar" style="margin-top:8px">
          <div class="seats-fill ${isFull ? 'full' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
      ${ev.notes ? `<div class="event-notes">${escapeHtml(ev.notes)}</div>` : ''}
      ${deadlineHtml}
    </div>
    <div class="event-card-footer">
      <button class="btn btn-primary"
        ${isFull || deadlinePast ? 'disabled' : ''}
        onclick="openClaimModal('${escapeHtml(ev.id)}', '${escapeHtml(ev.title)}', ${avail})">
        ${isFull ? 'No Seats Left' : deadlinePast ? 'Deadline Passed' : 'Claim Seats'}
      </button>
    </div>`;
  return card;
}

function deadlineClass(ts) {
  if (!ts) return '';
  const diff = ts.toDate() - new Date();
  if (diff < 0)                    return 'deadline-passed';
  if (diff < 48 * 3600 * 1000)    return 'deadline-soon';
  return 'deadline-ok';
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
      const released   = claim.status === 'released';
      const eventTitle = claim.event?.title || 'Unknown Event';

      item.innerHTML = `
        <div class="claim-info">
          <div class="claim-title">${escapeHtml(eventTitle)}</div>
          <div class="claim-meta">
            ${formatDate(claim.event?.date)}
            &nbsp;·&nbsp; ${claim.seatCount} seat${claim.seatCount !== 1 ? 's' : ''}
            ${claim.event?.venue ? ` &nbsp;·&nbsp; ${escapeHtml(claim.event.venue)}` : ''}
          </div>
          ${claim.notes ? `<div class="claim-meta" style="margin-top:4px;font-style:italic">"${escapeHtml(claim.notes)}"</div>` : ''}
        </div>
        <div class="claim-actions">
          <span class="badge badge-${released ? 'released' : 'confirmed'}">
            ${released ? 'Released' : 'Confirmed'}
          </span>
          ${!released ? `
            <button class="btn btn-ghost btn-sm"
              onclick="releaseClaim('${claim.id}', '${claim.eventId}', ${claim.seatCount})">
              Release
            </button>` : ''}
        </div>`;
      list.appendChild(item);
    });

    container.appendChild(list);
  });
}

// ---- Claim Modal ------------------------------------------------
window.openClaimModal = function(eventId, title, available) {
  selectedEvent = { id: eventId, title, available };
  document.getElementById('claimEventTitle').textContent = title;
  document.getElementById('claimSeatsMax').textContent   = available;
  const seatsInput   = document.getElementById('claimSeats');
  seatsInput.value   = 1;
  seatsInput.max     = Math.min(available, 6);
  document.getElementById('claimNotes').value = '';
  document.getElementById('claimError').classList.add('hidden');
  document.getElementById('claimModal').classList.remove('hidden');
};

window.closeClaimModal = function() {
  document.getElementById('claimModal').classList.add('hidden');
  selectedEvent = null;
};

window.adjustSeats = function(delta) {
  const input = document.getElementById('claimSeats');
  const next  = parseInt(input.value) + delta;
  const max   = parseInt(input.max);
  if (next >= 1 && next <= max) input.value = next;
};

document.getElementById('claimModal').addEventListener('click', (e) => {
  if (e.target.id === 'claimModal') window.closeClaimModal();
});

document.getElementById('submitClaim').addEventListener('click', async () => {
  if (!selectedEvent) return;

  const seatCount = parseInt(document.getElementById('claimSeats').value);
  const notes     = document.getElementById('claimNotes').value.trim();
  const errEl     = document.getElementById('claimError');

  if (!seatCount || seatCount < 1) {
    errEl.textContent = 'Please select at least 1 seat.';
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

      const avail = eventDoc.data().availableSeats;
      if (avail < seatCount) throw new Error(`Only ${avail} seat${avail !== 1 ? 's' : ''} left.`);

      // Create the claim
      const claimRef = doc(collection(db, 'claims'));
      tx.set(claimRef, {
        userId:           currentUser.uid,
        userEmail:        currentUser.email,
        userDisplayName:  currentProfile?.displayName || currentUser.email,
        eventId:          selectedEvent.id,
        eventTitle:       selectedEvent.title,
        seatCount,
        status:           'confirmed',
        notes,
        claimedAt:        serverTimestamp(),
      });

      // Decrement available seats atomically
      tx.update(eventRef, { availableSeats: avail - seatCount });
    });

    window.closeClaimModal();
    showToast(`${seatCount} seat${seatCount !== 1 ? 's' : ''} claimed! See "My Claims".`, 'success');
  } catch (err) {
    errEl.textContent = err.message || 'Failed to claim. Please try again.';
    errEl.classList.remove('hidden');
    btn.disabled    = false;
    btn.textContent = 'Confirm Claim';
  }
});

// ---- Release ----------------------------------------------------
window.releaseClaim = async function(claimId, eventId, seatCount) {
  const ok = await showConfirm(
    `Release ${seatCount} seat${seatCount !== 1 ? 's' : ''}? This frees them up for others and cannot be undone.`,
    'Release Seats'
  );
  if (!ok) return;

  try {
    await runTransaction(db, async (tx) => {
      const claimRef = doc(db, 'claims', claimId);
      const eventRef = doc(db, 'events', eventId);
      const [claimDoc, eventDoc] = await Promise.all([tx.get(claimRef), tx.get(eventRef)]);

      if (!claimDoc.exists())                       throw new Error('Claim not found.');
      if (claimDoc.data().status === 'released')    throw new Error('Already released.');

      tx.update(claimRef, { status: 'released', releasedAt: serverTimestamp() });
      if (eventDoc.exists()) {
        tx.update(eventRef, {
          availableSeats: (eventDoc.data().availableSeats || 0) + seatCount,
        });
      }
    });
    showToast('Tickets released successfully.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to release tickets.', 'error');
  }
};
