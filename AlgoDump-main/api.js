// ── algodump-main/api.js ──────────────────────────────────────────────────
// Frontend API client. Connects to the Node.js backend at localhost:3000.
// Used by ALL pages. Load this FIRST before any other script on every page.
// ─────────────────────────────────────────────────────────────────────────

const API = {

  BASE: 'http://localhost:3000',

  // ── Core fetch helper ─────────────────────────────────────────────────
  async call(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('algora_token');
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(API.BASE + endpoint, opts);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || data.message || 'Something went wrong');
    }
    return data;
  },

  // ── Auth endpoints ────────────────────────────────────────────────────

  // Step 1 of signup: create account → OTP sent to email
  async signup(name, email, phone, password, role) {
    return API.call('/api/signup', 'POST', { name, email, phone, password, role });
  },

  // Step 1 of login: verify password → OTP sent to email
  async login(email, password) {
    return API.call('/api/login', 'POST', { email, password });
  },

  // Step 2 of login: verify OTP → returns JWT + full user object
  async verifyOtp(email, otp) {
  const result = await API.call('/api/verify-otp', 'POST', { email, otp });
  // Auto-save session so pages don't have to do it manually
  if (result.token && result.user) {
    API.saveSession(result.token, result.user);
  }
  return result;
},
  // ── Wallet endpoints ──────────────────────────────────────────────────

  // Get live wallet info for a user (balance, address, etc.)
  async getWallet(algoId) {
    return API.call('/api/wallet/' + algoId);
  },

  // Transfer ALGR tokens
  async sendTokens(fromAlgoId, toAddress, amount, memo) {
    return API.call('/api/send-tokens', 'POST', {
      from: fromAlgoId,
      to: toAddress,
      amount,
      memo
    });
  },

  // ── Proposal / Multisig endpoints ────────────────────────────────────

  // Create a new multisig proposal
  async propose(payload) {
    return API.call('/api/propose', 'POST', payload);
  },

  // Sign an existing proposal
  async signProposal(proposalId, algoId) {
    return API.call('/api/sign', 'POST', { proposalId, algoId });
  },

  // Get all proposals for a user (as proposer or co-signer)
  async getProposals(algoId) {
    return API.call('/api/proposals?algoId=' + algoId);
  },

  // ── Session helpers ───────────────────────────────────────────────────

  // Save JWT + user to localStorage after successful login
  saveSession(token, user) {
    localStorage.setItem('algora_token', token);
    localStorage.setItem('algora_user', JSON.stringify(user));
  },

  // Load saved session — returns { token, user } or null
  loadSession() {
    const token = localStorage.getItem('algora_token');
    const raw   = localStorage.getItem('algora_user');
    if (!token || !raw) return null;
    try {
      const user = JSON.parse(raw);

return {
  token,
  user: {
    ...user,
    walletAddress: user.wallet_address   // ✅ THIS LINE FIXES EVERYTHING
  }
};
    } catch(e) {
      return null;
    }
  },

  // Clear session on logout
  clearSession() {
    localStorage.removeItem('algora_token');
    localStorage.removeItem('algora_user');
  },

  // Check if session exists
  isLoggedIn() {
    return !!localStorage.getItem('algora_token');
  }
};