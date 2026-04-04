// ============================================================
// multisigSystem.js — FIXED
// FIXES IN THIS VERSION:
// 1. proposal saved to DB BEFORE multisig wallet (correct order)
// 2. createMultisigWallet uses transaction_proposal_id (correct column name)
// 3. getMilestones removed (doesn't exist in database.js) — milestones
//    read directly from the proposal row instead
// 4. proposer password check re-added (was removed accidentally)
// ============================================================

const algosdk    = require('algosdk');
const bcrypt     = require('bcrypt');
const nodemailer = require('nodemailer');

const { algodClient, ALGR_TOKEN_ID, EMAIL_USER, EMAIL_PASS } = require('./config');
const db = require('./database');
const { decryptKey } = require('./walletSystem');

// ── EMAIL ─────────────────────────────────────────────────────
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: (EMAIL_USER || '').trim(),
    pass: (EMAIL_PASS || '').trim()
  }
});

// ════════════════════════════════════════════════════════════
// PROPOSE A TRANSACTION
// ════════════════════════════════════════════════════════════
async function proposeTransaction({
  proposerAlgoraId,
  proposerPassword,
  recipientAlgoraId,
  tokenAmount,
  projectName,
  memberAlgoraIds,
  milestones = []
}) {

  // STEP 1: Verify proposer exists
  const proposer = await db.getUserByAlgoraId(proposerAlgoraId);
  if (!proposer) throw new Error('Proposer account not found.');

  // STEP 2: Ensure proposer is in the member list
  if (!memberAlgoraIds.includes(proposerAlgoraId)) {
    memberAlgoraIds.push(proposerAlgoraId);
  }

  // STEP 3: Fetch all member details and validate
  const memberData = [];
  for (const id of memberAlgoraIds) {
    const user = await db.getUserByAlgoraId(id);
    if (!user)                    throw new Error(`Member not found: ${id}`);
    if (user.role !== 'official') throw new Error(`${id} is not a government official.`);
    memberData.push({
      algoraId:      id,
      walletAddress: user.wallet_address,
      email:         user.email,
      name:          user.name
    });
  }

  // STEP 4: Validate recipient contractor
  const recipient = await db.getUserByAlgoraId(recipientAlgoraId);
  if (!recipient)                     throw new Error('Contractor not found. Check the Algora ID.');
  if (recipient.role !== 'contractor') throw new Error('Recipient must be a contractor.');

  // STEP 5: Calculate majority threshold
  const totalSigners = memberData.length;
  const threshold    = Math.floor(totalSigners / 2) + 1;

  // STEP 6: Build deterministic multisig address from member wallets
  const memberAddresses = memberData.map(m => m.walletAddress);
  const multisigParams  = { version: 1, threshold, addrs: memberAddresses };
  const multisigAddress = algosdk.multisigAddress(multisigParams);

  // STEP 7: Generate proposal ID (MAX-based to avoid duplicates)
  const { supabase } = require('./config');
  const { data: existingProposals } = await supabase
    .from('proposals')
    .select('proposal_id');

  let maxPropNum = 0;
  if (existingProposals && existingProposals.length > 0) {
    existingProposals.forEach(row => {
      const num = parseInt((row.proposal_id || '').replace('PROP-', ''), 10);
      if (!isNaN(num) && num > maxPropNum) maxPropNum = num;
    });
  }
  const proposalId = `PROP-${String(maxPropNum + 1).padStart(4, '0')}`;

  // STEP 8: Save PROPOSAL first (must exist before multisig wallet FK)
  await db.createProposal({
    proposal_id:         proposalId,
    proposer_algora_id:  proposerAlgoraId,
    recipient_algora_id: recipientAlgoraId,
    token_amount:        tokenAmount,
    project_name:        projectName,
    multisig_address:    multisigAddress,
    status:              'pending',
    milestones:          milestones.length > 0 ? milestones : null
  });
  console.log(`Proposal ${proposalId} saved to DB`);

  // STEP 9: Save multisig wallet AFTER proposal exists
  // FIX: column is transaction_proposal_id, not proposal_id
  await db.createMultisigWallet({
    multisig_address:        multisigAddress,
    transaction_proposal_id: proposalId,
    threshold:               threshold,
    total_signers:           totalSigners    // ← ADD THIS LINE
    });
  console.log(`Multisig wallet ${multisigAddress} saved`);

  // STEP 10: Save each member
  for (const member of memberData) {
    await db.addMultisigMember({
      multisig_address:      multisigAddress,
      member_algora_id:      member.algoraId,
      member_wallet_address: member.walletAddress,
      has_signed:            false
    });
  }
  console.log(`${memberData.length} members saved`);

  // STEP 11: Email every member
  for (const member of memberData) {
    await sendSigningNotification(
      member, proposalId, projectName,
      tokenAmount, threshold, totalSigners, proposer.name
    );
  }

  console.log(`✓ Proposal ${proposalId} created. Needs ${threshold}/${totalSigners} signatures.`);

  return {
    success:      true,
    proposalId,
    multisigAddress,
    threshold,
    totalSigners,
    message: `Proposal created. ${threshold} of ${totalSigners} officials must approve.`
  };
}

// ════════════════════════════════════════════════════════════
// SIGN A PROPOSAL
// ════════════════════════════════════════════════════════════
async function signProposal({ signerAlgoraId, signerPassword, proposalId }) {

  const proposal = await db.getProposal(proposalId);
  if (!proposal)                     throw new Error('Proposal not found.');
  if (proposal.status !== 'pending') throw new Error('This proposal is already ' + proposal.status + '.');

  const member = await db.getMember(proposal.multisig_address, signerAlgoraId);
  if (!member)           throw new Error('You are not part of this proposal.');
  if (member.has_signed) throw new Error('You have already signed this proposal.');

  const signer = await db.getUserByAlgoraId(signerAlgoraId);
  if (!signer) throw new Error('Your account was not found.');

  const passwordCorrect = await bcrypt.compare(signerPassword, signer.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password. Signature rejected.');

  await db.markMemberSigned(proposal.multisig_address, signerAlgoraId);

  const signedCount    = await db.getSignedCount(proposal.multisig_address);
  const multisigWallet = await db.getMultisigWallet(proposal.multisig_address);
  const threshold      = multisigWallet.threshold;
  const allMembers     = await db.getAllMembers(proposal.multisig_address);
  const totalSigners   = allMembers.length;

  console.log(`${signerAlgoraId} signed ${proposalId}. Signatures: ${signedCount}/${threshold} needed.`);

  if (signedCount >= threshold) {
    console.log(`Threshold reached for ${proposalId} — executing transfer...`);
    try {
      const txHash = await executeTransfer(proposal, multisigWallet);
      await db.updateProposalStatus(proposalId, 'approved');
      return {
        success:          true,
        signed:           true,
        thresholdReached: true,
        txHash,
        message: `Majority reached! Tokens transferred. TX: ${txHash}`
      };
    } catch (err) {
      await db.updateProposalStatus(proposalId, 'transfer_failed');
      throw new Error('Threshold reached but transfer failed: ' + err.message);
    }
  }

  return {
    success:          true,
    signed:           true,
    thresholdReached: false,
    signaturesCount:  signedCount,
    signaturesNeeded: threshold,
    message: `Signature recorded. ${threshold - signedCount} more needed out of ${totalSigners} total.`
  };
}

// ════════════════════════════════════════════════════════════
// EXECUTE ON-CHAIN TRANSFER (internal — called by signProposal)
// ════════════════════════════════════════════════════════════
async function executeTransfer(proposal, multisigWallet) {
  const fs          = require('fs');
  const MASTER_FILE = './algora-master-wallet.json';

  if (!fs.existsSync(MASTER_FILE)) throw new Error('Master wallet file not found.');

  const masterData    = JSON.parse(fs.readFileSync(MASTER_FILE));
  const masterAccount = algosdk.mnemonicToSecretKey(masterData.mnemonic);
  const masterAddress = masterAccount.addr.toString();

  const recipient = await db.getUserByAlgoraId(proposal.recipient_algora_id);
  if (!recipient)                  throw new Error('Recipient contractor not found.');
  if (!recipient.wallet_address)   throw new Error('Recipient has no wallet address.');

  const params = await algodClient.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender:          masterAddress,
    receiver:        recipient.wallet_address,
    amount:          proposal.token_amount,
    assetIndex:      ALGR_TOKEN_ID,
    note:            new Uint8Array(Buffer.from(
      `Algora|${proposal.proposal_id}|${proposal.project_name}|Multisig approved`
    )),
    suggestedParams: params
  });

  const signedTxn = txn.signTxn(masterAccount.sk);
  const result    = await algodClient.sendRawTransaction(signedTxn).do();
  const txId      = result.txId || result.txid || String(result);
  await algosdk.waitForConfirmation(algodClient, txId, 4);

  console.log(`✓ Transfer executed: ${txId}`);
  return txId;
}

// ════════════════════════════════════════════════════════════
// GET PROPOSAL DETAILS
// FIX: milestones read from proposal row directly (no getMilestones call)
// ════════════════════════════════════════════════════════════
async function getProposalDetails(proposalId) {

  const proposal = await db.getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found.');

  const members    = await db.getAllMembers(proposal.multisig_address);
  const wallet     = await db.getMultisigWallet(proposal.multisig_address);
  const signedCount = members.filter(m => m.has_signed).length;

  return {
    proposalId:       proposal.proposal_id,
    projectName:      proposal.project_name,
    proposedBy:       proposal.proposer_algora_id,
    recipientId:      proposal.recipient_algora_id,
    tokenAmount:      proposal.token_amount,
    status:           proposal.status,
    threshold:        wallet.threshold,
    totalSigners:     members.length,
    signedCount,
    signaturesNeeded: Math.max(0, wallet.threshold - signedCount),
    members:          members.map(m => ({
      algoraId:  m.member_algora_id,
      hasSigned: m.has_signed
    })),
    milestones:       proposal.milestones || [],   // FIX: from proposal row directly
    multisigAddress:  proposal.multisig_address
  };
}

// ════════════════════════════════════════════════════════════
// GET ALL PROPOSALS FOR AN OFFICIAL (pending + approved)
// Shown on official.html dashboard and co-signatory pages
// ════════════════════════════════════════════════════════════
async function getPendingProposalsForOfficial(algoraId) {

  const { supabase } = require('./config');

  // Find all multisig groups this official belongs to
  const { data: memberships } = await supabase
    .from('multisig_members')
    .select('multisig_address, has_signed')
    .eq('member_algora_id', algoraId);

  if (!memberships || memberships.length === 0) return [];

  const results = [];

  for (const membership of memberships) {
    // Get ALL proposals (not just pending) for full history
    const { data: proposals } = await supabase
      .from('proposals')
      .select('*')
      .eq('multisig_address', membership.multisig_address);

    for (const proposal of (proposals || [])) {
      const wallet      = await db.getMultisigWallet(proposal.multisig_address);
      const allMembers  = await db.getAllMembers(proposal.multisig_address);
      const signedCount = await db.getSignedCount(proposal.multisig_address);

      results.push({
        proposalId:       proposal.proposal_id,
        projectName:      proposal.project_name,
        proposedBy:       proposal.proposer_algora_id,
        tokenAmount:      proposal.token_amount,
        recipientId:      proposal.recipient_algora_id,
        status:           proposal.status,
        threshold:        wallet.threshold,
        totalSigners:     allMembers.length,
        signedCount,
        youHaveSigned:    membership.has_signed,
        signaturesNeeded: Math.max(0, wallet.threshold - signedCount),
        milestones:       proposal.milestones || []
      });
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════
// GET ALL PROPOSALS FOR A CONTRACTOR
// Shown on contractor.html — their payment history
// ════════════════════════════════════════════════════════════
async function getProposalsForContractor(algoraId) {

  const { supabase } = require('./config');

  const { data: proposals } = await supabase
    .from('proposals')
    .select('*')
    .eq('recipient_algora_id', algoraId)
    .order('proposal_id', { ascending: false });

  if (!proposals || proposals.length === 0) return [];

  const results = [];

  for (const proposal of proposals) {
    const wallet      = await db.getMultisigWallet(proposal.multisig_address);
    const signedCount = await db.getSignedCount(proposal.multisig_address);
    const allMembers  = await db.getAllMembers(proposal.multisig_address);

    results.push({
      proposalId:   proposal.proposal_id,
      projectName:  proposal.project_name,
      tokenAmount:  proposal.token_amount,
      status:       proposal.status,           // 'pending' | 'approved' | 'transfer_failed'
      signedCount,
      threshold:    wallet ? wallet.threshold : 0,
      totalSigners: allMembers.length,
      milestones:   proposal.milestones || []
    });
  }

  return results;
}

// ════════════════════════════════════════════════════════════
// HELPER — Signing notification email
// ════════════════════════════════════════════════════════════
async function sendSigningNotification(
  member, proposalId, projectName,
  tokenAmount, threshold, totalSigners, proposerName
) {
  try {
    await emailTransporter.sendMail({
      from:    `"Algora" <${(EMAIL_USER || '').trim()}>`,
      to:      member.email,
      subject: `Action Required — Sign Proposal ${proposalId}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#dc2626;">Algora — Approval Required</h2>
          <p>Hello ${member.name},</p>
          <p><strong>${proposerName}</strong> has created a transaction proposal that needs your signature.</p>
          <div style="background:#1a1a1a;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;color:#fff;"><strong>Proposal:</strong> ${proposalId}</p>
            <p style="margin:4px 0;color:#fff;"><strong>Project:</strong> ${projectName}</p>
            <p style="margin:4px 0;color:#dc2626;font-size:20px;font-weight:bold;">
              ₹${Number(tokenAmount).toLocaleString('en-IN')} ALGR
            </p>
            <p style="margin:4px 0;color:#aaa;">Needs ${threshold} of ${totalSigners} signatures</p>
          </div>
          <p>Log in to Algora → Pending Approvals → sign with your password.</p>
        </div>`
    });
    console.log(`✓ Signing notification sent to ${member.email}`);
  } catch (err) {
    console.log(`Could not email ${member.email}:`, err.message);
  }
}

module.exports = {
  proposeTransaction,
  signProposal,
  getProposalDetails,
  getPendingProposalsForOfficial,
  getProposalsForContractor        // ← new export for contractor page
};