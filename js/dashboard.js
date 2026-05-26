// js/dashboard.js — user-facing ticket claiming dashboard

import { auth, db } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, setDoc, updateDoc, query, where, orderBy,
  runTransaction, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  requireAuth, formatDate, formatDateShort,
  showToast, showConfirm, escapeHtml, TICKET_SETS, TICKET_SET_COUNTS,
} from './common.js';

let currentUser      = null;
let currentProfile   = null;
let selectedEvent    = null;
const eventsCache    = {};
let allUpcomingEvents = [];
let hiddenEvents      = new Set();

requireAuth(async (user, profile) => {
  currentUser    = user;
  currentProfile = profile;

  // Header
  document.getElementById('userName').textContent    = profile?.displayName || user.email;
  document.getElementById('userInitial').textContent = (profile?.displayName || user.email)[0].toUpperCase();
  if (profile?.role === 'admin') {
    document.getElementById('adminLink').classList.remove('hidden');
  } else {
    document.querySelector('.header-nav').classList.add('hidden');
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
    setupCodeRedemption(user);
    return;
  }

  setupTabs();
  loadEvents();
  loadMyClaims();
  subscribeHiddenEvents();
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
  document.getElementById('eventsContainer').innerHTML =
    '<div class="loading"><div class="spinner"></div> Loading games…</div>';

  const q = query(collection(db, 'events'), orderBy('date', 'asc'));

  onSnapshot(q, (snap) => {
    const now = new Date();
    snap.docs.forEach(d => { eventsCache[d.id] = { id: d.id, ...d.data() }; });
    allUpcomingEvents = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => !e.date || e.date.toDate() >= now);
    renderAvailableEvents();
    renderHiddenEvents();
  }, (err) => {
    document.getElementById('eventsContainer').innerHTML =
      `<div class="empty-state"><p>Error loading games: ${escapeHtml(err.message)}</p></div>`;
  });
}

function renderAvailableEvents() {
  const container = document.getElementById('eventsContainer');
  const visible = allUpcomingEvents.filter(e => !hiddenEvents.has(e.id));

  if (visible.length === 0) {
    const someHidden = allUpcomingEvents.some(e => hiddenEvents.has(e.id));
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎟️</div>
        <p>${someHidden
          ? 'All upcoming games are hidden. Check the Hidden tab to restore them.'
          : 'No upcoming games yet — check back soon!'}</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'events-grid';
  visible.forEach(ev => grid.appendChild(buildEventCard(ev)));
  container.appendChild(grid);
}

function renderHiddenEvents() {
  const container = document.getElementById('hiddenContainer');
  const hidden = allUpcomingEvents.filter(e => hiddenEvents.has(e.id));

  const tabBtn = document.getElementById('hiddenTabBtn');
  if (tabBtn) tabBtn.textContent = hidden.length > 0 ? `Hidden (${hidden.length})` : 'Hidden';

  if (hidden.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👁️</div>
        <p>No hidden games. Use the Hide button on any game you can't make it to.</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'events-grid';
  hidden.forEach(ev => grid.appendChild(buildHiddenCard(ev)));
  container.appendChild(grid);
}

function buildEventCard(ev) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const anyAvail = Object.values(ev.ticketSets || {}).some(s => s.available);

  const setsHtml = Object.entries(TICKET_SETS).map(([key, label]) => {
    const avail = ev.ticketSets?.[key]?.available;
    const price = ev.ticketSets?.[key]?.price;
    const count = TICKET_SET_COUNTS[key] ?? 0;
    const ticketWord = count === 1 ? 'ticket' : 'tickets';
    const subline = price != null
      ? `${count} ${ticketWord} · $${Number(price).toFixed(2)}`
      : `${count} ${ticketWord}`;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:500;line-height:1.3">${escapeHtml(label)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${subline}</div>
        </div>
        <span class="badge ${avail ? 'badge-available' : 'badge-full'}" style="flex-shrink:0">${avail ? 'Open' : 'Taken'}</span>
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
    <div class="event-card-footer" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <button class="btn btn-primary" ${anyAvail ? '' : 'disabled'}
        onclick="openClaimModal('${escapeHtml(ev.id)}')">
        ${anyAvail ? 'Claim Tickets' : 'All Sets Taken'}
      </button>
      <button class="btn btn-ghost btn-sm" onclick="hideEvent('${escapeHtml(ev.id)}')" title="Hide this game">
        Hide
      </button>
    </div>`;
  return card;
}

function buildHiddenCard(ev) {
  const card = document.createElement('div');
  card.className = 'event-card';
  card.innerHTML = `
    <div class="event-card-header">
      <div class="event-date">${formatDate(ev.date)}</div>
      <div class="event-title">Seahawks vs. ${escapeHtml(ev.title)}</div>
    </div>
    <div class="event-card-footer">
      <button class="btn btn-ghost btn-sm" onclick="unhideEvent('${escapeHtml(ev.id)}')">
        Unhide
      </button>
    </div>`;
  return card;
}

// ---- Hide / Unhide ----------------------------------------------
function subscribeHiddenEvents() {
  const userRef = doc(db, 'users', currentUser.uid);
  onSnapshot(userRef, (snap) => {
    const data = snap.data() || {};
    hiddenEvents = new Set(data.hiddenEvents || []);
    renderAvailableEvents();
    renderHiddenEvents();
  });
}

window.hideEvent = async function(eventId) {
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      hiddenEvents: arrayUnion(eventId),
    });
  } catch (err) {
    showToast('Failed to hide game.', 'error');
  }
};

window.unhideEvent = async function(eventId) {
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      hiddenEvents: arrayRemove(eventId),
    });
  } catch (err) {
    showToast('Failed to unhide game.', 'error');
  }
};

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
    claims.sort((a, b) => (a.event?.date?.seconds || 0) - (b.event?.date?.seconds || 0));

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
    const price = ev.ticketSets?.[key]?.price;
    const count = TICKET_SET_COUNTS[key] ?? 0;
    const ticketWord = count === 1 ? 'ticket' : 'tickets';
    const subline = price != null
      ? `${count} ${ticketWord} · $${Number(price).toFixed(2)}`
      : `${count} ${ticketWord}`;
    return `
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:2px solid var(--border);border-radius:var(--radius-sm);transition:var(--transition)"
             onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'var(--primary)':'var(--border)'">
        <input type="checkbox" id="claimSet_${key}" value="${key}" style="width:16px;height:16px;flex-shrink:0;cursor:pointer">
        <div>
          <div style="font-size:14px;font-weight:500">${escapeHtml(label)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${subline}</div>
        </div>
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

// ---- Invite Code Redemption -------------------------------------
function setupCodeRedemption(user) {
  const btn      = document.getElementById('redeemCodeBtn');
  const input    = document.getElementById('inviteCodeInput');
  const errorEl  = document.getElementById('codeError');

  async function redeem() {
    const code = input.value.trim().toUpperCase();
    errorEl.textContent = '';
    if (!code) { errorEl.textContent = 'Please enter a code.'; return; }

    btn.disabled    = true;
    btn.textContent = 'Redeeming…';

    try {
      const codeRef = doc(db, 'inviteCodes', code);

      // Step 1: Claim the invite code atomically. Single-document transaction
      // so two simultaneous attempts on the same code produce a clear error.
      await runTransaction(db, async (tx) => {
        const codeSnap = await tx.get(codeRef);
        if (!codeSnap.exists()) throw new Error('Invalid code — please check and try again.');
        const codeData = codeSnap.data();
        if (codeData.used && codeData.usedBy !== user.uid) {
          throw new Error('This code has already been used.');
        }
        if (!codeData.used) {
          tx.update(codeRef, {
            used: true,
            usedBy: user.uid,
            usedByEmail: user.email,
            usedAt: serverTimestamp(),
          });
        }
      });

      // Step 2: Approve the user. Use setDoc+merge so that if the profile doc
      // was never created (broken redirect flow) it gets created here too.
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          await updateDoc(userRef, { status: 'approved', usedInviteCode: code });
        } else {
          await setDoc(userRef, {
            email:          user.email,
            displayName:    user.displayName || user.email,
            role:           'user',
            status:         'approved',
            usedInviteCode: code,
            createdAt:      serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('[redeem] step 2 (approve user) failed:', err.code, err.message);
        throw err;
      }

      showToast('Code accepted! Welcome to Season Tix.', 'success');
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to redeem code. Please try again.';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Redeem';
    }
  }

  btn.addEventListener('click', redeem);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
}

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
