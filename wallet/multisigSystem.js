// ============================================================
// multisigSystem.js
// This file handles everything related to ministers forming
// a collective wallet together and approving transactions.
//
// HOW IT WORKS IN PLAIN ENGLISH:
// 1. A minister proposes sending tokens to a contractor
// 2. Algora creates a brand new shared wallet for that proposal
// 3. All the ministers in that group get notified by email
// 4. Each minister logs in and signs the proposal with their password
// 5. The moment the majority have signed → tokens auto-transfer
// 6. Nobody can stop it at that point — it's on the blockchain
// ============================================================

const algosdk = require('algosdk');
const bcrypt  = require('bcrypt');
const nodemailer = require('nodemailer');

const { algodClient, ALGR_TOKEN_ID, EMAIL_USER, EMAIL_PASS } = require('./config');
const db = require('./database');
const { decryptKey } = require('./walletSystem');

// ── EMAIL SENDER ─────────────────────────────────────────────
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});


// ════════════════════════════════════════════════════════════
// FUNCTION 1 — PROPOSE A TRANSACTION
// Called when a minister fills out the "send tokens" form.
//
// What it needs:
//   proposerAlgoraId    → the minister making the proposal (e.g. GOV-MIN-0001)
//   proposerPassword    → their password (to confirm it's really them)
//   recipientAlgoraId   → the contractor receiving tokens (e.g. CON-0001)
//   tokenAmount         → how many ALGR tokens to send
//   projectName         → name of the project (e.g. "NH-48 Highway Repair")
//   memberAlgoraIds     → array of ALL minister IDs who will vote
//                         e.g. ['GOV-MIN-0001', 'GOV-MIN-0002', 'GOV-MIN-0003']
//   milestones          → array of milestone objects
//                         e.g. [{ description: 'Foundation laid', tokenAmount: 500 },
//                                { description: 'Road surfaced',   tokenAmount: 300 }]
//
// What it does:
//   → Verifies the proposer's password
//   → Creates a fresh multisig wallet address from all the members
//   → Saves the proposal to Supabase
//   → Emails every member to tell them to come sign
//
// What it returns:
//   { proposalId, multisigAddress, threshold, totalSigners, message }
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

  // ── STEP 1: Verify the proposer is who they say they are ──
  const proposer = await db.getUserByAlgoraId(proposerAlgoraId);
  if (!proposer) throw new Error('Proposer account not found.');

  const passwordCorrect = await bcrypt.compare(proposerPassword, proposer.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password. Proposal cancelled.');

  // ── STEP 2: Make sure the proposer is in the member list ──
  // The person proposing must also be one of the signers
  if (!memberAlgoraIds.includes(proposerAlgoraId)) {
    memberAlgoraIds.push(proposerAlgoraId);
  }

  // ── STEP 3: Get wallet addresses of all members ───────────
  const memberData = [];
  for (const id of memberAlgoraIds) {
    const user = await db.getUserByAlgoraId(id);
    if (!user) throw new Error(`Member not found: ${id}. Check the Algora ID.`);
    if (user.role !== 'official') throw new Error(`${id} is not a government official.`);
    memberData.push({ algoraId: id, walletAddress: user.wallet_address, email: user.email, name: user.name });
  }

  // ── STEP 4: Get the contractor ────────────────────────────
  const recipient = await db.getUserByAlgoraId(recipientAlgoraId);
  if (!recipient) throw new Error('Contractor not found. Check the Algora ID.');
  if (recipient.role !== 'contractor') throw new Error('Recipient must be a contractor.');

  // ── STEP 5: Calculate the majority threshold ──────────────
  // More than half must approve. No fixed number — always majority.
  const totalSigners = memberData.length;
  const threshold    = Math.ceil(totalSigners / 2) + 1;

  // ── STEP 6: Build the multisig wallet address ─────────────
  // Algorand creates a unique address from the list of members.
  // Same members always = same address. This is deterministic.
  const memberAddresses = memberData.map(m => m.walletAddress);

  const multisigParams = {
    version:   1,
    threshold: threshold,
    addrs:     memberAddresses
  };

  const multisigAddress = algosdk.multisigAddress(multisigParams);

  // ── STEP 7: Generate a proposal ID ───────────────────────
  const count      = await db.countProposals();
  const proposalId = `PROP-${String(count + 1).padStart(4, '0')}`;

  // ── STEP 8: Save the multisig wallet to database ──────────
  await db.createMultisigWallet({
    multisig_address:        multisigAddress,
    transaction_proposal_id: proposalId,
    threshold:               threshold,
    total_signers:           totalSigners
  });

  // ── STEP 9: Save each member to database ──────────────────
  for (const member of memberData) {
    await db.addMultisigMember({
      multisig_address:      multisigAddress,
      member_algora_id:      member.algoraId,
      member_wallet_address: member.walletAddress,
      has_signed:            false
    });
  }

  // ── STEP 10: Save the proposal to database ────────────────
  await db.createProposal({
    proposal_id:         proposalId,
    proposed_by:         proposerAlgoraId,
    recipient_algora_id: recipientAlgoraId,
    token_amount:        tokenAmount,
    project_name:        projectName,
    multisig_address:    multisigAddress,
    status:              'pending'
  });

  // ── STEP 11: Save milestones if provided ──────────────────
  if (milestones.length > 0) {
    for (let i = 0; i < milestones.length; i++) {
      await db.createMilestone({
        proposal_id:      proposalId,
        milestone_number: i + 1,
        description:      milestones[i].description,
        token_amount:     milestones[i].tokenAmount,
        status:           'pending'
      });
    }
  }

  // ── STEP 12: Email every member to notify them ────────────
  for (const member of memberData) {
    await sendSigningNotification(member, proposalId, projectName, tokenAmount, threshold, totalSigners, proposer.name);
  }

  console.log(`Proposal ${proposalId} created. Needs ${threshold} of ${totalSigners} signatures.`);

  return {
    success:       true,
    proposalId,
    multisigAddress,
    threshold,
    totalSigners,
    message:       `Proposal created. ${threshold} of ${totalSigners} officials must approve.`
  };
}


// ════════════════════════════════════════════════════════════
// FUNCTION 2 — SIGN A PROPOSAL
// Called when a minister clicks "Approve" on a pending proposal.
//
// What it needs:
//   signerAlgoraId  → the minister who is signing
//   signerPassword  → their password
//   proposalId      → which proposal they're signing (e.g. PROP-0001)
//
// What it does:
//   → Checks their password
//   → Marks them as signed in the database
//   → Counts total signatures so far
//   → If threshold reached → executes the token transfer automatically
//
// What it returns:
//   { signed, thresholdReached, signaturesCount, signaturesNeeded, message }
// ════════════════════════════════════════════════════════════
async function signProposal({ signerAlgoraId, signerPassword, proposalId }) {

  // ── STEP 1: Get the proposal ──────────────────────────────
  const proposal = await db.getProposal(proposalId);
  if (!proposal)                    throw new Error('Proposal not found.');
  if (proposal.status !== 'pending') throw new Error('This proposal is already ' + proposal.status + '.');

  // ── STEP 2: Check this official is actually a member ──────
  const member = await db.getMember(proposal.multisig_address, signerAlgoraId);
  if (!member)           throw new Error('You are not part of this proposal.');
  if (member.has_signed) throw new Error('You have already signed this proposal.');

  // ── STEP 3: Verify their password ────────────────────────
  const signer = await db.getUserByAlgoraId(signerAlgoraId);
  if (!signer) throw new Error('Your account was not found.');

  const passwordCorrect = await bcrypt.compare(signerPassword, signer.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password. Signature rejected.');

  // ── STEP 4: Mark this member as signed ───────────────────
  await db.markMemberSigned(proposal.multisig_address, signerAlgoraId);

  // ── STEP 5: Count how many have signed now ────────────────
  const signedCount   = await db.getSignedCount(proposal.multisig_address);
  const multisigWallet = await db.getMultisigWallet(proposal.multisig_address);
  const threshold      = multisigWallet.threshold;
  const totalSigners   = multisigWallet.total_signers;

  console.log(`${signerAlgoraId} signed PROP ${proposalId}. Signatures: ${signedCount}/${threshold} needed.`);

  // ── STEP 6: Check if threshold is reached ────────────────
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
        message:          `Majority reached! Tokens have been transferred to the contractor. TX: ${txHash}`
      };

    } catch (err) {
      // Transfer failed — mark proposal as failed
      await db.updateProposalStatus(proposalId, 'transfer_failed');
      throw new Error('Threshold reached but transfer failed: ' + err.message);
    }
  }

  // Threshold not yet reached — just confirm the signature
  return {
    success:          true,
    signed:           true,
    thresholdReached: false,
    signaturesCount:  signedCount,
    signaturesNeeded: threshold,
    message:          `Signature recorded. ${threshold - signedCount} more needed out of ${totalSigners} total.`
  };
}


// ════════════════════════════════════════════════════════════
// FUNCTION 3 — EXECUTE THE ACTUAL TRANSFER (internal)
// This runs automatically when enough ministers have signed.
// You never call this directly — signProposal() calls it.
// ════════════════════════════════════════════════════════════
async function executeTransfer(proposal, multisigWallet) {

  // ── Get all signed members and their private keys ─────────
  const signedMembers = await db.getSignedMembers(proposal.multisig_address);

  // ── Get all member addresses for rebuilding multisig params ─
  const allMembers = await db.getAllMembers(proposal.multisig_address);
  const allAddresses = allMembers.map(m => m.member_wallet_address);

  // Rebuild the multisig params exactly as they were when created
  const multisigParams = {
    version:   1,
    threshold: multisigWallet.threshold,
    addrs:     allAddresses
  };

  // ── Get recipient wallet address ──────────────────────────
  const recipient = await db.getUserByAlgoraId(proposal.recipient_algora_id);
  if (!recipient) throw new Error('Recipient not found during transfer.');

  // ── Build the transaction ─────────────────────────────────
  const params = await algodClient.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from:            proposal.multisig_address,  // FROM the collective wallet
    to:              recipient.wallet_address,    // TO the contractor
    amount:          proposal.token_amount,
    assetIndex:      ALGR_TOKEN_ID,
    note:            new Uint8Array(Buffer.from(
                       `Algora: ${proposal.proposal_id} — ${proposal.project_name}`
                     )),
    suggestedParams: params
  });

  // ── Sign with each minister's private key ─────────────────
  // Each signed minister's key is decrypted just long enough to sign
  const signedTxnBlobs = [];

  for (const member of signedMembers) {
    // Get the encrypted key — it comes joined from the DB query
    const encryptedKey   = member.users
      ? member.users.encrypted_private_key
      : member.encrypted_private_key;

    const privateKeyBase64 = decryptKey(encryptedKey);
    const privateKey       = Buffer.from(privateKeyBase64, 'base64');

    // Sign this transaction with this minister's key
    const { blob } = algosdk.signMultisigTransaction(txn, multisigParams, privateKey);
    signedTxnBlobs.push(blob);
  }

  // ── Merge all signatures into one transaction ─────────────
  const mergedTxn = algosdk.mergeMultisigTransactions(signedTxnBlobs);

  // ── Send to Algorand blockchain ───────────────────────────
  const { txId } = await algodClient.sendRawTransaction(mergedTxn).do();

  // ── Wait for confirmation (takes about 4 seconds) ─────────
  await algosdk.waitForConfirmation(algodClient, txId, 4);

  console.log(`Transfer executed on blockchain: ${txId}`);
  return txId;
}


// ════════════════════════════════════════════════════════════
// FUNCTION 4 — GET PROPOSAL DETAILS
// Called when a minister opens their "pending approvals" list.
// ════════════════════════════════════════════════════════════
async function getProposalDetails(proposalId) {

  const proposal = await db.getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found.');

  // Get member list and their signing status
  const members  = await db.getAllMembers(proposal.multisig_address);
  const wallet   = await db.getMultisigWallet(proposal.multisig_address);
  const milestones = await db.getMilestones(proposalId);

  const signedCount = members.filter(m => m.has_signed).length;

  return {
    proposalId:       proposal.proposal_id,
    projectName:      proposal.project_name,
    proposedBy:       proposal.proposed_by,
    recipientId:      proposal.recipient_algora_id,
    tokenAmount:      proposal.token_amount,
    status:           proposal.status,
    threshold:        wallet.threshold,
    totalSigners:     wallet.total_signers,
    signedCount,
    signaturesNeeded: Math.max(0, wallet.threshold - signedCount),
    members: members.map(m => ({
      algoraId:  m.member_algora_id,
      hasSigned: m.has_signed
    })),
    milestones,
    multisigAddress: proposal.multisig_address
  };
}


// ════════════════════════════════════════════════════════════
// FUNCTION 5 — GET ALL PENDING PROPOSALS FOR AN OFFICIAL
// Called when a minister opens their dashboard to see what
// needs their signature.
// ════════════════════════════════════════════════════════════
async function getPendingProposalsForOfficial(algoraId) {

  // Get all multisig groups this official belongs to
  const { supabase } = require('./config');

  const { data: memberships } = await supabase
    .from('multisig_members')
    .select('multisig_address, has_signed')
    .eq('member_algora_id', algoraId);

  if (!memberships || memberships.length === 0) return [];

  const results = [];

  for (const membership of memberships) {
    // Get the proposal linked to this multisig wallet
    const { data: proposals } = await supabase
      .from('proposals')
      .select('*')
      .eq('multisig_address', membership.multisig_address)
      .eq('status', 'pending');

    for (const proposal of (proposals || [])) {
      const wallet     = await db.getMultisigWallet(proposal.multisig_address);
      const signedCount = await db.getSignedCount(proposal.multisig_address);

      results.push({
        proposalId:       proposal.proposal_id,
        projectName:      proposal.project_name,
        proposedBy:       proposal.proposed_by,
        tokenAmount:      proposal.token_amount,
        recipientId:      proposal.recipient_algora_id,
        threshold:        wallet.threshold,
        totalSigners:     wallet.total_signers,
        signedCount,
        youHaveSigned:    membership.has_signed,
        signaturesNeeded: Math.max(0, wallet.threshold - signedCount)
      });
    }
  }

  return results;
}


// ════════════════════════════════════════════════════════════
// HELPER — Send email to notify a minister they need to sign
// ════════════════════════════════════════════════════════════
async function sendSigningNotification(member, proposalId, projectName, tokenAmount, threshold, totalSigners, proposerName) {
  try {
    await emailTransporter.sendMail({
      from:    `"Algora" <${EMAIL_USER}>`,
      to:      member.email,
      subject: `Action Required — Sign Proposal ${proposalId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a3a5c;">Algora — Approval Required</h2>
          <p>Hello ${member.name},</p>
          <p><strong>${proposerName}</strong> has created a transaction proposal that requires your signature.</p>

          <div style="background: #f0f4f8; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Proposal ID:</strong> ${proposalId}</p>
            <p style="margin: 4px 0;"><strong>Project:</strong> ${projectName}</p>
            <p style="margin: 4px 0;"><strong>Amount:</strong> ${tokenAmount.toLocaleString('en-IN')} ALGR (₹${tokenAmount.toLocaleString('en-IN')})</p>
            <p style="margin: 4px 0;"><strong>Signatures needed:</strong> ${threshold} out of ${totalSigners}</p>
          </div>

          <p>Log in to Algora and go to <strong>Pending Approvals</strong> to review and sign.</p>
          <p style="color: #888; font-size: 12px;">
            Do not share your password with anyone. Algora will never ask for your password over email or phone.
          </p>
        </div>
      `
    });
  } catch (err) {
    // Email failure should not crash the whole proposal
    console.log(`Could not email ${member.email}:`, err.message);
  }
}


module.exports = {
  proposeTransaction,
  signProposal,
  getProposalDetails,
  getPendingProposalsForOfficial
};