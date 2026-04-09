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
// ════════════════════════════════════════════════════════════
app.post('/api/verify-otp', async (req, res) => {
  try {
    const email   = req.body.email;
    const otpCode = req.body.otpCode || req.body.otp;

    if (!email || !otpCode) {
      return res.status(400).json({ error: 'Email and OTP required.' });
    }

    const result = await loginStep2({ email, otpCode });

    const token = jwt.sign(
      { algoraId: result.algoraId, role: result.role, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

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
// ════════════════════════════════════════════════════════════
app.get('/api/proposals', async (req, res) => {
  try {
    const { algoId, all } = req.query;
    if (!algoId) return res.json({ proposals: [] });

    if (all === 'true') {
      // Return ALL proposals where this official is a member (any status)
      const { supabase } = require('./config');
      const { data: memberships } = await supabase
        .from('multisig_members')
        .select('multisig_address')
        .eq('member_algora_id', algoId);

      if (!memberships || memberships.length === 0) return res.json({ proposals: [] });

      const addresses = memberships.map(m => m.multisig_address);
      const { data: proposals } = await supabase
        .from('proposals')
        .select('*')
        .in('multisig_address', addresses)
        .order('proposal_id', { ascending: false });

      // Deduplicate by proposal_id
      const seen   = new Set();
      const unique = (proposals || []).filter(p => {
        if (seen.has(p.proposal_id)) return false;
        seen.add(p.proposal_id);
        return true;
      });

      // Enrich with signed counts + whether THIS user has signed
      const { supabase: sb } = require('./config');
      const enriched = await Promise.all(unique.map(async p => {

        // How many members have signed this proposal's multisig wallet
        const { count } = await sb
          .from('multisig_members')
          .select('*', { count: 'exact', head: true })
          .eq('multisig_address', p.multisig_address)
          .eq('has_signed', true);

        // Threshold required
        const { data: mw } = await sb
          .from('multisig_wallets')
          .select('threshold')
          .eq('multisig_address', p.multisig_address)
          .single();

        // ── FIX: Check if THIS specific user has already signed ──────────
        const { data: myRow } = await sb
          .from('multisig_members')
          .select('has_signed')
          .eq('multisig_address', p.multisig_address)
          .eq('member_algora_id', algoId)
          .single();
        // ─────────────────────────────────────────────────────────────────

        return {
          ...p,
          signed_count:    count || 0,
          threshold:       mw?.threshold || '?',
          you_have_signed: myRow?.has_signed || false  // NEW FIELD
        };
      }));

      return res.json({ proposals: enriched });
    }

    // Default: pending proposals only (proposals this user hasn't signed yet)
    const proposals = await getPendingProposalsForOfficial(algoId);
    res.json({ proposals: proposals || [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// GET /api/contractor-proposals?algoId=CON-0001
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
// ════════════════════════════════════════════════════════════
app.post('/api/propose', async (req, res) => {
  try {
    const body    = req.body;
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