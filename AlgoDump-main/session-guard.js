// ── algodump-main/session-guard.js ───────────────────────────────────────
// Load this on EVERY dashboard page (official, citizen, contractor).
// It checks if user is logged in. If not → redirects to login.
// If yes → populates window.currentUser and fetches live data.
//
// IMPORTANT: load api.js BEFORE this file on every page.
// ─────────────────────────────────────────────────────────────────────────

(async function () {

  // ── 1. Check session ──────────────────────────────────────────────────
  const sess = API.loadSession();

  if (!sess || !sess.token || !sess.user) {
    // Not logged in — send to login page
    // Path is relative to the page loading this script
    window.location.href = '../landing_page/signup_login.html';
    return;
  }

  const u = sess.user;

  // ── 2. Populate window.currentUser immediately from saved session ──────
  // This makes the page render instantly without waiting for API responses
  window.currentUser = {
    name:         u.name            || '—',
    role:         u.role            || 'official',
    govId:        u.algoraId        || u.algoId          || u.govId         || '—',
    wallet:       u.walletAddress   || u.wallet        || '—',
    msigAddress:  u.msigAddress     || '—',
    email:        u.email           || '—',
    phone:        u.phone           || '—',
    uid:          u.uid             || u.id            || '—',
    algrBalance:  u.algrBalance     || '—',
    msigBalance:  u.msigBalance     || '—',
  };

  // ── 3. Update static elements already in HTML ─────────────────────────
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('gov-id-val',   window.currentUser.govId);
  set('wallet-addr',  window.currentUser.wallet);

  // off-name might not exist on every page — guard it
  const nameEl = document.getElementById('off-name');
  if (nameEl) nameEl.textContent = window.currentUser.name;

  // ── 4. Fetch LIVE wallet data from backend in background ──────────────
  try {
    const live = await API.getWallet(window.currentUser.govId);

    // Update currentUser with latest live data
    if (live.walletAddress)   window.currentUser.wallet       = live.walletAddress;
    if (live.algrBalance)     window.currentUser.algrBalance  = live.algrBalance;
    if (live.msigAddress)     window.currentUser.msigAddress  = live.msigAddress;
    if (live.msigBalance)     window.currentUser.msigBalance  = live.msigBalance;

    // Update wallet display in the page
    set('wallet-addr', window.currentUser.wallet);

    // Update pending approvals badge in nav
    const pendingCount = live.pendingProposals || 0;
    set('nav-badge', pendingCount);
    const psPill = document.getElementById('ps-pill');
    if (psPill) psPill.textContent = pendingCount + ' Pending';
    const pstrip = document.getElementById('pstrip');
    if (pstrip) pstrip.style.display = pendingCount > 0 ? 'flex' : 'none';

    // Update wallet panel if it's open
    const wpBal = document.getElementById('wp-balance');
    if (wpBal) wpBal.textContent = window.currentUser.algrBalance;

  } catch (e) {
    // Not critical — page still works with session data
    console.warn('[Algora] Live wallet fetch failed:', e.message);
  }

  // ── 5. Fetch live proposals from backend ──────────────────────────────
  try {
    const pendRes = await API.getProposals(window.currentUser.govId);
    if (pendRes && pendRes.proposals) {
      window.LIVE_PENDING = pendRes.proposals;
      // Re-render if function exists
      if (typeof renderIdentity === 'function') renderIdentity();
    }
  } catch (e) {
    console.warn('[Algora] Proposals fetch failed:', e.message);
  }

})();