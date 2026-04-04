// ============================================================
// server.js  — FIXED VERSION
// Run with: node server.js
// ============================================================

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const jwt     = require('jsonwebtoken');

const { PORT } = require('./config');
const { signUpUser, loginStep1, loginStep2, getWalletInfo, sendALGR } = require('./walletSystem');
const { proposeTransaction, signProposal, getProposalDetails, 
        getPendingProposalsForOfficial, getProposalsForContractor } = require('./multisigSystem');

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'algora-fallback-secret-change-this';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ════════════════════════════════════════════════════════════
// ROUTE 1 — SIGN UP
// Creates account + Algorand wallet automatically
// Frontend sends:  { name, email, phone, password, role }
// Server returns:  { success, algoraId, walletAddress, name, role }
// ════════════════════════════════════════════════════════════
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Please fill in all fields.' });
    }
    if (!['official', 'contractor', 'citizen'].includes(role)) {
  return res.status(400).json({ error: 'Role must be official, contractor, or citizen.' });
}
    const result = await signUpUser({ name, email, phone, password, role });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 2 — LOGIN STEP 1
// Checks email + password, sends OTP to email
// Frontend sends:  { email, password }
// Server returns:  { success, message }
// ════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required.' });
    }
    const result = await loginStep1({ email, password });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 3 — LOGIN STEP 2 (OTP VERIFY)
// Verifies OTP — returns JWT token + full user object
// Frontend sends:  { email, otp }  OR  { email, otpCode }
// Server returns:  { success, token, user: { algoraId, name, role, walletAddress, email } }
// ════════════════════════════════════════════════════════════
app.post('/api/verify-otp', async (req, res) => {
  try {
    const email   = req.body.email;
    const otpCode = req.body.otpCode || req.body.otp;  // accept both field names

    if (!email || !otpCode) {
      return res.status(400).json({ error: 'Email and OTP required.' });
    }

    const result = await loginStep2({ email, otpCode });

    // Create JWT — stays valid for 7 days
    const token = jwt.sign(
      { algoraId: result.algoraId, role: result.role, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return in the exact shape api.js and session-guard.js expect
    res.json({
      success: true,
      token,
      user: {
        algoraId:      result.algoraId,
        name:          result.name,
        role:          result.role,
        walletAddress: result.walletAddress,
        email
      }
    });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 4 — GET WALLET INFO
// Returns live wallet balance + address for the popup
// Frontend sends:  GET /api/wallet/GOV-MIN-0001
// Server returns:  { algoraId, name, walletAddress, tokenBalance, totalTransactions }
// ════════════════════════════════════════════════════════════
app.get('/api/wallet/:algoraId', async (req, res) => {
  try {
    const result = await getWalletInfo(req.params.algoraId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 5 — GET ALL PROPOSALS FOR A USER
// Returns pending proposals where this user is a signer
// Frontend sends:  GET /api/proposals?algoId=GOV-MIN-0001
// Server returns:  { proposals: [...] }
// ════════════════════════════════════════════════════════════
app.get('/api/proposals', async (req, res) => {
  try {
    const { algoId } = req.query;
    if (!algoId) return res.json({ proposals: [] });
    const proposals = await getPendingProposalsForOfficial(algoId);
    res.json({ proposals: proposals || [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/contractor-proposals?algoId=CON-0001
// Returns all proposals where this contractor is the recipient
app.get('/api/contractor-proposals', async (req, res) => {
  try {
    const { algoId } = req.query;
    if (!algoId) return res.json({ proposals: [] });
    const { getProposalsForContractor } = require('./multisigSystem');
    const proposals = await getProposalsForContractor(algoId);
    res.json({ proposals: proposals || [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 6 — PROPOSE A TRANSACTION
// Minister creates a new multisig proposal
// Frontend sends payload with memberAlgoraIds array
// Server returns:  { proposalId, multisigAddress, threshold, message }
// ════════════════════════════════════════════════════════════
app.post('/api/propose', async (req, res) => {
  try {
    // Map frontend field names to what multisigSystem.js expects
    const body = req.body;
    const payload = {
      proposerAlgoraId:  body.proposerAlgoId  || body.proposerAlgoraId,
      proposerPassword:  body.password        || body.proposerPassword || '',
      recipientAlgoraId: body.recipientAlgoId || body.recipientAlgoraId || '',
      tokenAmount:       body.amount          || body.tokenAmount || 0,
      projectName:       body.project         || body.projectName || '',
      memberAlgoraIds:   body.memberAlgoraIds || [],
      milestones:        body.milestones      || []
    };
    const result = await proposeTransaction(payload);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 7 — SIGN A PROPOSAL
// Minister approves a pending proposal
// Frontend sends:  { signerAlgoraId, signerPassword, proposalId }
// Server returns:  { signed, thresholdReached, message, txHash }
// ════════════════════════════════════════════════════════════
app.post('/api/sign', async (req, res) => {
  try {
    const result = await signProposal(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 8 — GET PROPOSAL DETAILS
// Returns full details of one proposal including signing status
// Frontend sends:  GET /api/proposal/PROP-0001
// ════════════════════════════════════════════════════════════
app.get('/api/proposal/:proposalId', async (req, res) => {
  try {
    const result = await getProposalDetails(req.params.proposalId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 9 — SEND TOKENS
// Transfers ALGR tokens between wallets
// Frontend sends:  { senderAlgoraId, senderPassword, recipientAddress, amount }
// ════════════════════════════════════════════════════════════
app.post('/api/send-tokens', async (req, res) => {
  try {
    const { senderAlgoraId, senderPassword, recipientAddress, amount } = req.body;
    const result = await sendALGR({ senderAlgoraId, senderPassword, recipientAddress, amount });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════
// ROUTE 10 — HEALTH CHECK
// Open http://localhost:3000/api/health to confirm server is up
// ════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ status: 'Algora wallet server is running ✓', time: new Date().toISOString() });
});


// ── START SERVER ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   ALGORA WALLET SERVER RUNNING       ║');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('Routes active:');
  console.log('  POST /api/signup        → signup + auto wallet');
  console.log('  POST /api/login         → password check + OTP');
  console.log('  POST /api/verify-otp    → OTP check + JWT token');
  console.log('  GET  /api/wallet/:id    → live wallet info');
  console.log('  GET  /api/proposals     → pending proposals list');
  console.log('  POST /api/propose       → create multisig proposal');
  console.log('  POST /api/sign          → sign a proposal');
  console.log('  GET  /api/proposal/:id  → proposal details');
  console.log('  POST /api/send-tokens   → transfer ALGR');
  console.log('  GET  /api/health        → server status');
  console.log('');
});