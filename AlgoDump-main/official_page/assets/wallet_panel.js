// ── ALGORA · WALLET PANEL ───────────────────────────────────────────────────
// Import: <script src="wallet-panel.js"></script>
// Usage:  WalletPanel.open()  /  WalletPanel.close()

const WalletPanel = (() => {

  const CSS = `
    #algora-wallet-backdrop {
      position: fixed; inset: 0; z-index: 8000;
      pointer-events: none; opacity: 0;
      transition: opacity 0.3s ease;
    }
    #algora-wallet-backdrop.open { opacity: 1; pointer-events: all; }

    #algora-wallet-dim {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(14px) saturate(60%);
      -webkit-backdrop-filter: blur(14px) saturate(60%);
    }

    #algora-wallet-panel {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%,-50%) scale(0.96);
      width: min(500px, 94vw);
      max-height: 90vh;
      background: rgba(8,2,2,0.68);
      backdrop-filter: blur(48px) saturate(180%);
      -webkit-backdrop-filter: blur(48px) saturate(180%);
      border: 1px solid rgba(220,38,38,0.28);
      border-radius: 20px;
      box-shadow: 0 40px 100px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.05);
      display: flex; flex-direction: column;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.32s cubic-bezier(0.16,1,0.3,1);
      overflow: hidden;
    }
    #algora-wallet-backdrop.open #algora-wallet-panel {
      opacity: 1;
      transform: translate(-50%,-50%) scale(1);
    }

    #algora-wallet-panel::before {
      content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(200,30,30,0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(200,30,30,0.08) 1px, transparent 1px);
      background-size: 44px 44px;
    }

    .wp-header {
      position: relative; z-index: 2;
      padding: 28px 32px 22px;
      border-bottom: 1px solid rgba(220,38,38,0.18);
      display: flex; align-items: flex-start; justify-content: space-between;
      flex-shrink: 0;
    }
    .wp-eyebrow {
      font-family: 'Lato', sans-serif; font-size: 9px; letter-spacing: 0.28em;
      text-transform: uppercase; color: rgba(220,38,38,0.8); font-weight: 700; margin-bottom: 7px;
    }
    .wp-title {
      font-family: 'Syncopate', sans-serif; font-size: 14px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase; color: #fff;
    }
    .wp-close {
      width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.5); font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.18s; font-family: 'Lato', sans-serif;
    }
    .wp-close:hover { background: rgba(220,38,38,0.2); border-color: rgba(220,38,38,0.5); color: #fff; }

    .wp-body {
      position: relative; z-index: 2; flex: 1; overflow-y: auto; padding: 26px 32px;
      display: flex; flex-direction: column; gap: 18px;
      scrollbar-width: thin; scrollbar-color: rgba(220,38,38,0.3) transparent;
    }
    .wp-body::-webkit-scrollbar { width: 3px; }
    .wp-body::-webkit-scrollbar-thumb { background: rgba(220,38,38,0.3); border-radius: 4px; }

    .wp-card {
      background: linear-gradient(135deg, rgba(220,38,38,0.1), rgba(0,0,0,0.25));
      border: 1px solid rgba(220,38,38,0.28);
      border-radius: 16px; padding: 22px 24px; position: relative; overflow: hidden;
    }
    .wp-card::after {
      content: ''; position: absolute; top: -50%; right: -20%; width: 200px; height: 200px;
      background: radial-gradient(circle, rgba(220,38,38,0.1), transparent 70%);
      border-radius: 50%; pointer-events: none;
    }
    .wp-card-label {
      font-family: 'Lato', sans-serif; font-size: 9px; letter-spacing: 0.24em;
      text-transform: uppercase; color: rgba(220,38,38,0.65); font-weight: 700; margin-bottom: 10px;
    }
    .wp-addr {
      font-family: 'Courier New', monospace; font-size: 11px;
      color: rgba(255,255,255,0.65); word-break: break-all; line-height: 1.6; margin-bottom: 16px;
    }
    .wp-balance-label {
      font-family: 'Lato', sans-serif; font-size: 9px; letter-spacing: 0.16em;
      text-transform: uppercase; color: rgba(255,255,255,0.32); margin-bottom: 4px;
    }
    .wp-balance {
      font-family: 'Syncopate', sans-serif; font-size: 26px; font-weight: 700;
      letter-spacing: -0.5px; color: #dc2626;
    }
    .wp-algr-note {
      font-family: 'Lato', sans-serif; font-size: 9px; color: rgba(255,255,255,0.28);
      font-weight: 300; margin-top: 5px; letter-spacing: 0.04em;
    }
    .wp-copy-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 7px; padding: 6px 12px; font-size: 10px;
      color: rgba(255,255,255,0.5); font-family: 'Lato', sans-serif; font-weight: 700;
      letter-spacing: 0.1em; cursor: pointer; transition: all 0.18s; margin-top: 14px;
    }
    .wp-copy-btn:hover { background: rgba(220,38,38,0.15); border-color: rgba(220,38,38,0.4); color: #fff; }

    .wp-badges {
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    .wp-badge {
      display: flex; align-items: center; gap: 8px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px; padding: 10px 14px; flex: 1; min-width: 110px;
    }
    .wp-badge-dot {
      width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
      animation: wpPulse 2s ease-in-out infinite;
    }
    @keyframes wpPulse { 0%,100%{opacity:1} 50%{opacity:0.28} }
    .wp-badge-main {
      font-family: 'Lato', sans-serif; font-size: 11px; font-weight: 700;
      letter-spacing: 0.04em;
    }
    .wp-badge-sub {
      font-family: 'Lato', sans-serif; font-size: 9px; color: rgba(255,255,255,0.28);
      font-weight: 300; margin-top: 1px; letter-spacing: 0.04em;
    }

    .wp-divider {
      font-family: 'Lato', sans-serif; font-size: 9px; letter-spacing: 0.24em;
      text-transform: uppercase; color: rgba(255,255,255,0.2);
      display: flex; align-items: center; gap: 12px;
    }
    .wp-divider::before, .wp-divider::after {
      content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.07);
    }

    .wp-activity-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 11px 14px; background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; margin-bottom: 7px;
    }
    .wp-activity-name {
      font-family: 'Lato', sans-serif; font-size: 11px; font-weight: 700; margin-bottom: 2px;
    }
    .wp-activity-hash {
      font-family: 'Courier New', monospace; font-size: 9px; color: rgba(255,255,255,0.28);
    }
    .wp-activity-amt {
      font-family: 'Syncopate', sans-serif; font-size: 12px; font-weight: 700;
      color: #dc2626; text-align: right;
    }
    .wp-activity-status {
      font-family: 'Lato', sans-serif; font-size: 9px; color: #4ade80;
      font-weight: 700; letter-spacing: 0.06em; text-align: right; margin-top: 2px;
    }

    .wp-empty {
      text-align: center; padding: 36px 20px;
      color: rgba(255,255,255,0.18); font-family: 'Lato', sans-serif;
      font-size: 11px; font-weight: 300; letter-spacing: 0.06em;
      background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.07);
      border-radius: 12px;
    }
    .wp-soon {
      background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.18);
      border-radius: 12px; padding: 14px 18px;
      font-family: 'Lato', sans-serif; font-size: 10px; font-weight: 300;
      color: rgba(251,191,36,0.65); text-align: center; line-height: 1.7; letter-spacing: 0.04em;
    }
  `;

  function inject() {
    if (document.getElementById('algora-wallet-backdrop')) return;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const backdrop = document.createElement('div');
    backdrop.id = 'algora-wallet-backdrop';
    backdrop.innerHTML = `
      <div id="algora-wallet-dim"></div>
      <div id="algora-wallet-panel">
        <div class="wp-header">
          <div>
            <div class="wp-eyebrow">Algorand · Pera Wallet</div>
            <div class="wp-title">My Wallet</div>
          </div>
          <div class="wp-close" onclick="WalletPanel.close()">✕</div>
        </div>
        <div class="wp-body">
          <div class="wp-card">
            <div class="wp-card-label">Personal Wallet Address</div>
            <div class="wp-addr" id="wp-addr">—</div>
            <div class="wp-balance-label">ALGR Balance</div>
            <div class="wp-balance" id="wp-balance">—</div>
            <div class="wp-algr-note">1 ALGR = ₹1 &nbsp;·&nbsp; Algorand Standard Asset #812673920</div>
            <button class="wp-copy-btn" id="wp-copy-btn" onclick="WalletPanel._copyAddr()">📋 Copy Address</button>
          </div>
          <div class="wp-badges">
            <div class="wp-badge">
              <div class="wp-badge-dot" style="background:#4ade80;"></div>
              <div><div class="wp-badge-main" style="color:#4ade80;">Connected</div><div class="wp-badge-sub">Pera Wallet</div></div>
            </div>
            <div class="wp-badge">
              <div class="wp-badge-dot" style="background:#4ade80;"></div>
              <div><div class="wp-badge-main" style="color:#4ade80;">Verified</div><div class="wp-badge-sub">Algorand Mainnet</div></div>
            </div>
            <div class="wp-badge">
              <div class="wp-badge-dot" style="background:#dc2626;"></div>
              <div><div class="wp-badge-main" id="wp-pending-badge" style="color:#dc2626;">0 Pending</div><div class="wp-badge-sub">Awaiting Sig.</div></div>
            </div>
          </div>
          <div class="wp-divider">Multisig Account</div>
          <div class="wp-card" style="background:linear-gradient(135deg,rgba(251,191,36,0.07),rgba(0,0,0,0.25));border-color:rgba(251,191,36,0.22);">
            <div class="wp-card-label" style="color:rgba(251,191,36,0.65);">Multisig Wallet Address</div>
            <div class="wp-addr" id="wp-msig-addr">—</div>
            <div class="wp-balance-label">ALGR Held in Multisig</div>
            <div class="wp-balance" id="wp-msig-balance" style="color:#fbbf24;">—</div>
            <div class="wp-algr-note">Requires threshold signatures to release funds</div>
          </div>
          <div class="wp-divider">Recent Activity</div>
          <div id="wp-activity"><div class="wp-empty">Recent transactions will appear here</div></div>
          <div class="wp-soon">🔗 &nbsp;Full Pera Wallet integration — swap, stake & on-chain explorer coming soon</div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById('algora-wallet-dim').addEventListener('click', () => WalletPanel.close());
  }

  return {
    open() {
      inject();
      const cu = window.currentUser || {};
      document.getElementById('wp-addr').textContent         = cu.wallet      || '—';
      document.getElementById('wp-msig-addr').textContent    = cu.msigAddress || '—';
      document.getElementById('wp-balance').textContent      = cu.algrBalance || '₹35,000 Cr';
      document.getElementById('wp-msig-balance').textContent = cu.msigBalance || '₹35,000 Cr';
      const pendingCount = typeof PENDING_TXS !== 'undefined' ? PENDING_TXS.filter(t => !t.youSigned).length : 0;
      document.getElementById('wp-pending-badge').textContent = pendingCount + ' Pending';
      const actEl = document.getElementById('wp-activity');
      if (typeof OFF_TX_HISTORY !== 'undefined' && OFF_TX_HISTORY.length) {
        actEl.innerHTML = OFF_TX_HISTORY.slice(0, 5).map(t => `
          <div class="wp-activity-item">
            <div>
              <div class="wp-activity-name">${t.project.slice(0,36)}${t.project.length>36?'…':''}</div>
              <div class="wp-activity-hash">${t.hash} · ${t.date}</div>
            </div>
            <div style="flex-shrink:0;margin-left:12px;">
              <div class="wp-activity-amt">${t.amount}</div>
              <div class="wp-activity-status">⬤ Confirmed</div>
            </div>
          </div>`).join('');
      }
      requestAnimationFrame(() => document.getElementById('algora-wallet-backdrop').classList.add('open'));
    },
    close() {
      const el = document.getElementById('algora-wallet-backdrop'); if (el) el.classList.remove('open');
    },
    _copyAddr() {
      navigator.clipboard.writeText((window.currentUser && window.currentUser.wallet) || '').catch(()=>{});
      const btn = document.getElementById('wp-copy-btn');
      btn.textContent = '✓ Copied!'; btn.style.color = '#4ade80';
      setTimeout(() => { btn.textContent = '📋 Copy Address'; btn.style.color = ''; }, 2000);
    }
  };
})();
