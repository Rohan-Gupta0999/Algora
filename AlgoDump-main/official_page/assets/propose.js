// ── ALGORA · PROPOSE TRANSACTION PANEL ──────────────────────────────────────
// Import: <script src="propose-panel.js"></script>
// Usage:  ProposePanel.open()  /  ProposePanel.close()

const ProposePanel = (() => {

  const CSS = `
    #algora-propose-backdrop {
      position: fixed; inset: 0; z-index: 8000;
      pointer-events: none; opacity: 0;
      transition: opacity 0.3s ease;
    }
    #algora-propose-backdrop.open { opacity: 1; pointer-events: all; }

    #algora-propose-dim {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(14px) saturate(60%);
      -webkit-backdrop-filter: blur(14px) saturate(60%);
    }

    #algora-propose-panel {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%,-50%) scale(0.96);
      width: min(560px, 94vw);
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
    #algora-propose-backdrop.open #algora-propose-panel {
      opacity: 1;
      transform: translate(-50%,-50%) scale(1);
    }

    #algora-propose-panel::before {
      content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(200,30,30,0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(200,30,30,0.08) 1px, transparent 1px);
      background-size: 44px 44px;
    }

    .pp-header {
      position: relative; z-index: 2;
      padding: 28px 32px 22px;
      border-bottom: 1px solid rgba(220,38,38,0.18);
      display: flex; align-items: flex-start; justify-content: space-between;
      flex-shrink: 0;
    }
    .pp-eyebrow {
      font-family: 'Lato', sans-serif;
      font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase;
      color: rgba(220,38,38,0.8); font-weight: 700; margin-bottom: 7px;
    }
    .pp-title {
      font-family: 'Syncopate', sans-serif;
      font-size: 14px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase; color: #fff;
    }
    .pp-close {
      width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.5); font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.18s; font-family: 'Lato', sans-serif;
    }
    .pp-close:hover { background: rgba(220,38,38,0.2); border-color: rgba(220,38,38,0.5); color: #fff; }

    .pp-body {
      position: relative; z-index: 2;
      flex: 1; overflow-y: auto; padding: 24px 32px;
      scrollbar-width: thin; scrollbar-color: rgba(220,38,38,0.3) transparent;
    }
    .pp-body::-webkit-scrollbar { width: 3px; }
    .pp-body::-webkit-scrollbar-thumb { background: rgba(220,38,38,0.3); border-radius: 4px; }

    .pp-section {
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
      border-radius: 12px; padding: 18px 20px; margin-bottom: 14px;
    }
    .pp-section-label {
      font-family: 'Lato', sans-serif; font-size: 9px; letter-spacing: 0.24em;
      text-transform: uppercase; color: rgba(220,38,38,0.7); font-weight: 700; margin-bottom: 14px;
    }
    .pp-field { margin-bottom: 11px; }
    .pp-field:last-child { margin-bottom: 0; }
    .pp-label {
      display: block; font-family: 'Lato', sans-serif; font-size: 9px;
      letter-spacing: 0.16em; text-transform: uppercase;
      color: rgba(255,255,255,0.38); font-weight: 400; margin-bottom: 5px;
    }
    .pp-input {
      width: 100%; padding: 10px 13px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; color: #fff; font-size: 13px;
      font-family: 'Lato', sans-serif; font-weight: 300; outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .pp-input::placeholder { color: rgba(255,255,255,0.22); }
    .pp-input:focus { border-color: rgba(220,38,38,0.55); box-shadow: 0 0 0 3px rgba(220,38,38,0.08); }
    .pp-input[readonly] { color: rgba(220,38,38,0.75); cursor: not-allowed; background: rgba(220,38,38,0.05); border-color: rgba(220,38,38,0.2); }
    select.pp-input { cursor: pointer; }
    textarea.pp-input { resize: none; }
    .pp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    .pp-cosigner-row {
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
      border-radius: 7px; padding: 8px 12px; margin-bottom: 7px;
    }
    .pp-cosigner-email { font-size: 11px; font-family: 'Lato', sans-serif; font-weight: 300; color: rgba(255,255,255,0.8); }
    .pp-cosigner-rm { color: rgba(220,38,38,0.6); cursor: pointer; font-size: 13px; padding: 2px 6px; transition: color 0.15s; }
    .pp-cosigner-rm:hover { color: #dc2626; }
    .pp-add-row { display: flex; gap: 8px; margin-top: 4px; }
    .pp-add-btn {
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 10px 16px; color: rgba(255,255,255,0.65);
      font-family: 'Lato', sans-serif; font-weight: 700; font-size: 11px;
      letter-spacing: 0.1em; cursor: pointer; white-space: nowrap; transition: all 0.18s;
    }
    .pp-add-btn:hover { background: rgba(220,38,38,0.15); border-color: rgba(220,38,38,0.4); color: #fff; }

    .pp-warn {
      background: rgba(220,38,38,0.07); border: 1px solid rgba(220,38,38,0.2);
      border-radius: 8px; padding: 11px 14px; margin-bottom: 14px;
      font-size: 10px; color: rgba(200,100,100,0.85); font-family: 'Lato', sans-serif;
      font-weight: 300; line-height: 1.7; letter-spacing: 0.02em;
    }
    .pp-error {
      display: none; font-size: 10px; color: #dc2626; font-family: 'Lato', sans-serif;
      font-weight: 700; letter-spacing: 0.08em;
      background: rgba(220,38,38,0.07); border: 1px solid rgba(220,38,38,0.2);
      border-radius: 7px; padding: 8px 12px; margin-bottom: 12px;
    }

    .pp-footer {
      position: relative; z-index: 2;
      padding: 16px 32px 26px; flex-shrink: 0;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .pp-submit {
      width: 100%; padding: 14px; background: #dc2626; border: none; border-radius: 8px;
      color: #fff; font-family: 'Lato', sans-serif; font-weight: 900;
      font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
      cursor: pointer; box-shadow: 0 0 28px rgba(220,38,38,0.32);
      transition: background 0.2s, box-shadow 0.2s, transform 0.1s;
    }
    .pp-submit:hover { background: #b91c1c; box-shadow: 0 0 44px rgba(220,38,38,0.55); }
    .pp-submit:active { transform: scale(0.99); }
    .pp-submit:disabled { opacity: 0.45; cursor: not-allowed; }
  `;

  let coSigners = [];

  function inject() {
    if (document.getElementById('algora-propose-backdrop')) return;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const backdrop = document.createElement('div');
    backdrop.id = 'algora-propose-backdrop';
    backdrop.innerHTML = `
      <div id="algora-propose-dim"></div>
      <div id="algora-propose-panel">
        <div class="pp-header">
          <div>
            <div class="pp-eyebrow">Algorand Multisig · On-Chain</div>
            <div class="pp-title">Propose Transaction</div>
          </div>
          <div class="pp-close" onclick="ProposePanel.close()">✕</div>
        </div>
        <div class="pp-body">
          <div class="pp-section">
            <div class="pp-section-label">Proposer Identity</div>
            <div class="pp-field">
              <label class="pp-label">Your Wallet (Auto-filled)</label>
              <input class="pp-input" id="pp-proposer-wallet" readonly placeholder="—">
            </div>
          </div>
          <div class="pp-section">
            <div class="pp-section-label">Recipient Details</div>
            <div class="pp-field"><label class="pp-label">Recipient Full Name *</label><input class="pp-input" id="pp-rec-name" type="text" placeholder="e.g. NHAI Regional Office UP"></div>
            <div class="pp-field"><label class="pp-label">Recipient Email *</label><input class="pp-input" id="pp-rec-email" type="email" placeholder="e.g. nhai.up@gov.in"></div>
          </div>
          <div class="pp-section">
            <div class="pp-section-label">Transaction Details</div>
            <div class="pp-row">
              <div class="pp-field"><label class="pp-label">Amount (ALGR = ₹) *</label><input class="pp-input" id="pp-amount" type="number" min="1" placeholder="e.g. 840000000"></div>
              <div class="pp-field"><label class="pp-label">Sector *</label><select class="pp-input" id="pp-sector"><option>Infrastructure</option><option>Health</option><option>Education</option><option>Agriculture</option><option>Social Welfare</option><option>Defence</option><option>Science & Technology</option></select></div>
            </div>
            <div class="pp-field"><label class="pp-label">Project / Purpose *</label><input class="pp-input" id="pp-project" type="text" placeholder="e.g. NH-58 Road Widening Phase 2"></div>
            <div class="pp-field"><label class="pp-label">Note / Memo</label><textarea class="pp-input" id="pp-note" rows="2" placeholder="Stored on-chain. Brief description."></textarea></div>
          </div>
          <div class="pp-section">
            <div class="pp-section-label">Co-Signatories — Min 2 Required</div>
            <div id="pp-cosigner-list"></div>
            <div class="pp-add-row">
              <input class="pp-input" id="pp-cosigner-input" type="text" placeholder="Algora ID e.g. GOV-MIN-0002" style="flex:1;">
              <button class="pp-add-btn" onclick="ProposePanel._addCoSigner()">+ Add</button>
            </div>
            <div style="font-size:9px;color:rgba(255,255,255,0.22);font-family:'Lato',sans-serif;font-weight:300;margin-top:8px;letter-spacing:0.06em;">Each co-signatory receives an email with approve / deny links.</div>
          </div>
          <div class="pp-warn">⚠ Transaction stored unsigned until threshold is reached. Every signature is permanently recorded on Algorand.</div>
          <div class="pp-error" id="pp-error"></div>
        </div>
        <div class="pp-footer">
          <button class="pp-submit" id="pp-submit-btn" onclick="ProposePanel._submit()">Propose Transaction →</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById('algora-propose-dim').addEventListener('click', () => ProposePanel.close());
  }

  function _renderCoSigners() {
    const list = document.getElementById('pp-cosigner-list'); if (!list) return;
    list.innerHTML = coSigners.map((c, i) => `<div class="pp-cosigner-row"><span class="pp-cosigner-email">${c}</span><span class="pp-cosigner-rm" onclick="ProposePanel._removeCoSigner(${i})">✕</span></div>`).join('');
  }

  return {
    open() {
      inject();
      document.getElementById('pp-proposer-wallet').value = (window.currentUser && window.currentUser.wallet) || '—';
      coSigners = []; _renderCoSigners();
      document.getElementById('pp-error').style.display = 'none';
      requestAnimationFrame(() => document.getElementById('algora-propose-backdrop').classList.add('open'));
    },
    close() {
      const el = document.getElementById('algora-propose-backdrop'); if (el) el.classList.remove('open');
    },
   _addCoSigner() {
  const input  = document.getElementById('pp-cosigner-input');
  const algoId = input.value.trim().toUpperCase();
  // Must look like GOV-MIN-0001
  if (!algoId || !algoId.startsWith('GOV-MIN-') || coSigners.includes(algoId)) return;
  if (window.currentUser && algoId === window.currentUser.govId) return;
  coSigners.push(algoId); input.value = ''; _renderCoSigners();
},
    _removeCoSigner(i) { coSigners.splice(i, 1); _renderCoSigners(); },
    async _submit() {
      const err = document.getElementById('pp-error'), btn = document.getElementById('pp-submit-btn');
      err.style.display = 'none';
      const recName = document.getElementById('pp-rec-name').value.trim();
      const recEmail = document.getElementById('pp-rec-email').value.trim().toLowerCase();
      const amount = document.getElementById('pp-amount').value.trim();
      const sector = document.getElementById('pp-sector').value;
      const project = document.getElementById('pp-project').value.trim();
      const note = document.getElementById('pp-note').value.trim() || 'No memo';
      if (!recName || !recEmail || !amount || !project) { err.textContent = '❌ Please fill all required fields.'; err.style.display = 'block'; return; }
      if (coSigners.length < 2) { err.textContent = '❌ Add at least 2 co-signatories.'; err.style.display = 'block'; return; }
      btn.textContent = 'Submitting…'; btn.disabled = true;
      const amtNum = parseFloat(amount.replace(/[^0-9.]/g, ''));
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
      const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) + ' IST';
      const newId = 'PTX-' + Date.now().toString(36).toUpperCase();
      const txData = { id: newId, project, sector: '📋 ' + sector, proposerName: window.currentUser?.name || '—', proposerEmail: window.currentUser?.email || '—', proposerWallet: window.currentUser?.wallet || '—', proposerGovId: window.currentUser?.govId || '—', proposerUid: window.currentUser?.uid || '—', recipient: { name: recName, email: recEmail, govId: 'GOV-' + Date.now().toString(36).toUpperCase(), wallet: 'PENDING' }, amount: '₹' + (amtNum >= 1e7 ? (amtNum/1e7).toFixed(2) + ' Cr' : amtNum.toLocaleString('en-IN')), amountRaw: amtNum, date: dateStr, time: timeStr, note, coSignerEmails: coSigners, threshold: coSigners.length + 1, total: coSigners.length + 1, signaturesGiven: [{ name: window.currentUser?.name, wallet: window.currentUser?.wallet, email: window.currentUser?.email, signedAt: dateStr + ' · ' + timeStr }], signerEmails: [window.currentUser?.email || ''], status: 'pending', createdAt: typeof firebase !== 'undefined' ? firebase.firestore.FieldValue.serverTimestamp() : new Date() };
      try {
  // Send to backend API
const payload = {
  proposerAlgoId:  window.currentUser?.govId,
  proposerWallet:  window.currentUser?.wallet,
  proposerName:    window.currentUser?.name,
  proposerEmail:   window.currentUser?.email,
  recipientName:   recName,
  recipientEmail:  recEmail,
  amount:          amtNum,
  sector:          sector,
  project:         project,
  note:            note,
  memberAlgoraIds: coSigners,    
  threshold:       coSigners.length + 1,
};

  const res = await API.propose(payload);
  // res = { success: true, proposalId: 'PTX-...', message: '...' }

  const finalId = (res && res.proposalId) ? res.proposalId : newId;
  txData.id = finalId;

  if (typeof window.onProposeTxSubmit === 'function') window.onProposeTxSubmit(txData);
  ProposePanel.close();
  if (typeof showToast === 'function') {
    showToast('📤 ' + finalId + ' proposed — emails sent to ' + coSigners.length + ' co-signatories');
  }
} catch(e) {
  err.textContent = '❌ Failed: ' + e.message;
  err.style.display = 'block';
}
      btn.textContent = 'Propose Transaction →'; btn.disabled = false;
    }
  };
})();
