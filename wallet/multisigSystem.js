// ============================================================
// multisigSystem.js — WITH RECEIPT EMAIL
// Added: sendReceiptToContractor() called after executeTransfer()
// ============================================================

const algosdk    = require('algosdk');
const bcrypt     = require('bcrypt');
const nodemailer = require('nodemailer');

const { algodClient, ALGR_TOKEN_ID, EMAIL_USER, EMAIL_PASS } = require('./config');
const db = require('./database');
const { decryptKey } = require('./walletSystem');

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
  const proposer = await db.getUserByAlgoraId(proposerAlgoraId);
  if (!proposer) throw new Error('Proposer account not found.');

  if (!memberAlgoraIds.includes(proposerAlgoraId)) {
    memberAlgoraIds.push(proposerAlgoraId);
  }

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

  const recipient = await db.getUserByAlgoraId(recipientAlgoraId);
  if (!recipient)                      throw new Error('Contractor not found. Check the Algora ID.');
  if (recipient.role !== 'contractor') throw new Error('Recipient must be a contractor.');

  const totalSigners = memberData.length;
  const threshold    = Math.floor(totalSigners / 2) + 1;

  const memberAddresses = memberData.map(m => m.walletAddress);
  const multisigParams  = { version: 1, threshold, addrs: memberAddresses };
  const multisigAddress = algosdk.multisigAddress(multisigParams);

  // MAX-based proposal ID
  const { supabase } = require('./config');
  const { data: existingProposals } = await supabase.from('proposals').select('proposal_id');
  let maxPropNum = 0;
  if (existingProposals && existingProposals.length > 0) {
    existingProposals.forEach(row => {
      const num = parseInt((row.proposal_id || '').replace('PROP-', ''), 10);
      if (!isNaN(num) && num > maxPropNum) maxPropNum = num;
    });
  }
  const proposalId = `PROP-${String(maxPropNum + 1).padStart(4, '0')}`;

  // Save proposal FIRST
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

  // Then multisig wallet
  await db.createMultisigWallet({
    multisig_address:        multisigAddress,
    transaction_proposal_id: proposalId,
    threshold:               threshold,
    total_signers:           totalSigners
  });
  console.log(`Multisig wallet ${multisigAddress} saved`);

  for (const member of memberData) {
    await db.addMultisigMember({
      multisig_address:      multisigAddress,
      member_algora_id:      member.algoraId,
      member_wallet_address: member.walletAddress,
      has_signed:            false
    });
  }
  console.log(`${memberData.length} members saved`);

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

      // ── SEND RECEIPT TO CONTRACTOR ───────────────────────
      // Runs after confirmed on-chain transfer
      const recipient = await db.getUserByAlgoraId(proposal.recipient_algora_id);
      if (recipient) {
        sendReceiptToContractor({
          contractor:   recipient,
          proposal,
          txHash,
          allMembers,
          threshold,
          totalSigners
        }).catch(e => console.log('Receipt email note:', e.message));
      }

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
// EXECUTE ON-CHAIN TRANSFER
// ════════════════════════════════════════════════════════════
async function executeTransfer(proposal, multisigWallet) {
  const fs          = require('fs');
  const MASTER_FILE = './algora-master-wallet.json';

  if (!fs.existsSync(MASTER_FILE)) throw new Error('Master wallet file not found.');

  const masterData    = JSON.parse(fs.readFileSync(MASTER_FILE));
  const masterAccount = algosdk.mnemonicToSecretKey(masterData.mnemonic);
  const masterAddress = masterAccount.addr.toString();

  const recipient = await db.getUserByAlgoraId(proposal.recipient_algora_id);
  if (!recipient)                throw new Error('Recipient contractor not found.');
  if (!recipient.wallet_address) throw new Error('Recipient has no wallet address.');

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
// SEND PAYMENT RECEIPT TO CONTRACTOR
// Sent immediately after on-chain transfer is confirmed.
// Contractor prints this and shows it to the bank to get cash.
// ════════════════════════════════════════════════════════════
async function sendReceiptToContractor({ contractor, proposal, txHash, allMembers, threshold, totalSigners }) {
  const now         = new Date();
  const dateStr     = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr     = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const amountINR   = Number(proposal.token_amount).toLocaleString('en-IN');
  const explorerUrl = `https://testnet.algoexplorer.io/tx/${txHash}`;
  const shortTx     = txHash.slice(0, 20) + '...' + txHash.slice(-10);

  // Build signatories list for the receipt
  const signedMembers = allMembers.filter(m => m.has_signed);
  const signatoriesHTML = signedMembers.map((m, i) =>
    `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;color:#aaa;">${i + 1}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;color:#fff;">${m.member_algora_id}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;color:#4ade80;">✓ Signed</td>
    </tr>`
  ).join('');

  try {
    await emailTransporter.sendMail({
      from:    `"Algora — Government of India" <${(EMAIL_USER || '').trim()}>`,
      to:      contractor.email.trim(),
      subject: `Payment Receipt — ${proposal.project_name} [${proposal.proposal_id}]`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">

<div style="max-width:600px;margin:0 auto;background:#111;border:1px solid #dc2626;border-radius:12px;overflow:hidden;">

  <!-- HEADER -->
  <div style="background:#dc2626;padding:24px 32px;text-align:center;">
    <div style="font-size:11px;letter-spacing:4px;color:rgba(255,255,255,0.8);margin-bottom:4px;">
      GOVERNMENT OF INDIA · ALGORA PROTOCOL
    </div>
    <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:2px;">
      PAYMENT RECEIPT
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:4px;">
      Blockchain-verified · Tamper-proof
    </div>
  </div>

  <!-- STATUS BADGE -->
  <div style="background:#0d1f0d;border-bottom:1px solid #166534;padding:12px 32px;text-align:center;">
    <span style="background:#166534;color:#4ade80;padding:6px 20px;border-radius:20px;
                 font-size:12px;font-weight:700;letter-spacing:2px;">
      ✓ PAYMENT CONFIRMED ON ALGORAND BLOCKCHAIN
    </span>
  </div>

  <!-- AMOUNT -->
  <div style="padding:32px;text-align:center;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:11px;letter-spacing:3px;color:#888;margin-bottom:8px;">AMOUNT TRANSFERRED</div>
    <div style="font-size:48px;font-weight:900;color:#4ade80;">
      ₹${amountINR}
    </div>
    <div style="font-size:14px;color:#888;margin-top:4px;">${amountINR} ALGR Tokens</div>
  </div>

  <!-- DETAILS TABLE -->
  <div style="padding:24px 32px;border-bottom:1px solid #1a1a1a;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">RECEIPT NO.</td>
        <td style="padding:10px 0;color:#fff;font-weight:700;text-align:right;">${proposal.proposal_id}</td>
      </tr>
      <tr style="border-top:1px solid #1a1a1a;">
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">PROJECT</td>
        <td style="padding:10px 0;color:#fff;font-weight:700;text-align:right;">${proposal.project_name}</td>
      </tr>
      <tr style="border-top:1px solid #1a1a1a;">
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">CONTRACTOR ID</td>
        <td style="padding:10px 0;color:#fff;font-weight:700;text-align:right;">${contractor.algora_id}</td>
      </tr>
      <tr style="border-top:1px solid #1a1a1a;">
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">CONTRACTOR NAME</td>
        <td style="padding:10px 0;color:#fff;font-weight:700;text-align:right;">${contractor.name}</td>
      </tr>
      <tr style="border-top:1px solid #1a1a1a;">
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">WALLET ADDRESS</td>
        <td style="padding:10px 0;color:#dc2626;font-family:monospace;font-size:11px;text-align:right;word-break:break-all;">
          ${contractor.wallet_address}
        </td>
      </tr>
      <tr style="border-top:1px solid #1a1a1a;">
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">DATE & TIME</td>
        <td style="padding:10px 0;color:#fff;font-weight:700;text-align:right;">${dateStr} · ${timeStr}</td>
      </tr>
      <tr style="border-top:1px solid #1a1a1a;">
        <td style="padding:10px 0;color:#888;font-size:12px;letter-spacing:1px;">APPROVALS</td>
        <td style="padding:10px 0;color:#4ade80;font-weight:700;text-align:right;">
          ${threshold} of ${totalSigners} officials signed
        </td>
      </tr>
    </table>
  </div>

  <!-- SIGNATORIES -->
  <div style="padding:24px 32px;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:11px;letter-spacing:3px;color:#888;margin-bottom:12px;">OFFICIAL SIGNATORIES</div>
    <table style="width:100%;border-collapse:collapse;background:#0a0a0a;border-radius:8px;overflow:hidden;">
      <tr style="background:#1a1a1a;">
        <th style="padding:8px 12px;color:#888;font-size:11px;text-align:left;">#</th>
        <th style="padding:8px 12px;color:#888;font-size:11px;text-align:left;">ALGORA ID</th>
        <th style="padding:8px 12px;color:#888;font-size:11px;text-align:left;">STATUS</th>
      </tr>
      ${signatoriesHTML}
    </table>
  </div>

  <!-- TRANSACTION HASH -->
  <div style="padding:24px 32px;border-bottom:1px solid #1a1a1a;background:#0a0a0a;">
    <div style="font-size:11px;letter-spacing:3px;color:#888;margin-bottom:8px;">BLOCKCHAIN TRANSACTION</div>
    <div style="font-family:monospace;font-size:12px;color:#dc2626;word-break:break-all;margin-bottom:12px;">
      ${txHash}
    </div>
    <a href="${explorerUrl}"
       style="display:inline-block;background:#1a1a1a;border:1px solid #dc2626;color:#dc2626;
              padding:8px 16px;border-radius:6px;font-size:11px;text-decoration:none;
              letter-spacing:1px;">
      VERIFY ON ALGORAND EXPLORER →
    </a>
  </div>

  <!-- BANK INSTRUCTION -->
  <div style="padding:24px 32px;background:#1a0d0d;border-top:2px solid #dc2626;">
    <div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:8px;letter-spacing:1px;">
      📋 BANK REDEMPTION INSTRUCTIONS
    </div>
    <ol style="color:#ccc;font-size:13px;line-height:1.8;padding-left:20px;margin:0;">
      <li>Print this email or show it on your phone at your affiliated bank branch.</li>
      <li>Quote <strong style="color:#fff;">Receipt No. ${proposal.proposal_id}</strong> to the bank officer.</li>
      <li>The bank will verify the transaction on Algorand blockchain.</li>
      <li>Upon verification, cash equivalent to <strong style="color:#4ade80;">₹${amountINR}</strong> will be disbursed.</li>
    </ol>
    <div style="margin-top:16px;padding:12px;background:#0a0a0a;border-radius:6px;
                font-size:11px;color:#888;border-left:3px solid #dc2626;">
      This receipt is cryptographically verified on the Algorand blockchain and cannot be forged.
      Transaction ID: <span style="color:#dc2626;font-family:monospace;">${shortTx}</span>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="padding:16px 32px;text-align:center;background:#0a0a0a;">
    <div style="font-size:10px;color:#444;letter-spacing:2px;">
      ALGORA PROTOCOL · GOVERNMENT FINANCIAL TRANSPARENCY SYSTEM
    </div>
    <div style="font-size:10px;color:#333;margin-top:4px;">
      Powered by Algorand Blockchain · Hack4Impact 2025
    </div>
  </div>

</div>
</body>
</html>`
    });

    console.log(`✓ Payment receipt sent to contractor ${contractor.email}`);
  } catch (err) {
    console.error(`❌ Could not send receipt to ${contractor.email}:`, err.message);
  }
}

// ════════════════════════════════════════════════════════════
// GET PROPOSAL DETAILS
// ════════════════════════════════════════════════════════════
async function getProposalDetails(proposalId) {
  const proposal = await db.getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found.');

  const members     = await db.getAllMembers(proposal.multisig_address);
  const wallet      = await db.getMultisigWallet(proposal.multisig_address);
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
    members:          members.map(m => ({ algoraId: m.member_algora_id, hasSigned: m.has_signed })),
    milestones:       proposal.milestones || [],
    multisigAddress:  proposal.multisig_address
  };
}

// ════════════════════════════════════════════════════════════
// GET ALL PROPOSALS FOR AN OFFICIAL (full history)
// ════════════════════════════════════════════════════════════
async function getPendingProposalsForOfficial(algoraId) {
  const { supabase } = require('./config');

  const { data: memberships } = await supabase
    .from('multisig_members')
    .select('multisig_address, has_signed')
    .eq('member_algora_id', algoraId);

  if (!memberships || memberships.length === 0) return [];

  const results = [];
  for (const membership of memberships) {
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
      status:       proposal.status,
      signedCount,
      threshold:    wallet ? wallet.threshold : 0,
      totalSigners: allMembers.length,
      milestones:   proposal.milestones || []
    });
  }
  return results;
}

// ════════════════════════════════════════════════════════════
// SIGNING NOTIFICATION EMAIL
// ════════════════════════════════════════════════════════════
async function sendSigningNotification(member, proposalId, projectName, tokenAmount, threshold, totalSigners, proposerName) {
  try {
    await emailTransporter.sendMail({
      from:    `"Algora" <${(EMAIL_USER || '').trim()}>`,
      to:      member.email,
      subject: `Action Required — Sign Proposal ${proposalId}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#111;padding:24px;border-radius:12px;">
          <h2 style="color:#dc2626;">Algora — Approval Required</h2>
          <p style="color:#ccc;">Hello ${member.name},</p>
          <p style="color:#ccc;"><strong style="color:#fff;">${proposerName}</strong> has created a transaction proposal needing your signature.</p>
          <div style="background:#1a1a1a;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;color:#fff;"><strong>Proposal:</strong> ${proposalId}</p>
            <p style="margin:4px 0;color:#fff;"><strong>Project:</strong> ${projectName}</p>
            <p style="margin:4px 0;color:#4ade80;font-size:20px;font-weight:bold;">
              ₹${Number(tokenAmount).toLocaleString('en-IN')} ALGR
            </p>
            <p style="margin:4px 0;color:#aaa;">Needs ${threshold} of ${totalSigners} signatures</p>
          </div>
          <p style="color:#ccc;">Log in to Algora → Pending Approvals → sign with your password.</p>
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
  getProposalsForContractor
};