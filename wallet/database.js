// ============================================================
// database.js
// All the functions that talk to Supabase.
// You don't need to change anything in this file.
// ============================================================

const { supabase } = require('./config');

// ── USERS ────────────────────────────────────────────────────

// Save a new user to the database
async function createUser(userData) {
  const { data, error } = await supabase
    .from('users')
    .insert([userData])
    .select()
    .single();
  if (error) throw new Error('Could not save user: ' + error.message);
  return data;
}

// Find a user by their Algora ID (e.g. GOV-MIN-0001)
async function getUserByAlgoraId(algoraId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('algora_id', algoraId)
    .single();
  return data; // returns null if not found
}

// Find a user by their email address
async function getUserByEmail(email) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  return data;
}

// Count how many users exist with a given role (used to generate IDs)
async function countUsersByRole(role) {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', role);
  return count || 0;
}

// ── OTP CODES ────────────────────────────────────────────────

// Save a new OTP for an email (expires in 10 minutes)
async function saveOTP(email, otpCode) {
  // First, delete any old unused OTPs for this email
  await supabase.from('otp_codes').delete().eq('email', email).eq('used', false);

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins from now

  const { error } = await supabase
    .from('otp_codes')
    .insert([{ email, otp_code: otpCode, expires_at: expiresAt }]);

  if (error) throw new Error('Could not save OTP: ' + error.message);
}

// Check if an OTP is correct and not expired
async function verifyOTP(email, otpCode) {
  const { data } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('email', email)
    .eq('otp_code', otpCode)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString()) // not expired
    .single();

  if (!data) return false; // wrong code or expired

  // Mark as used so it can't be used again
  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('id', data.id);

  return true;
}

// ── WALLET INFO ──────────────────────────────────────────────

// Get just the wallet address for a user (safe to show publicly)
async function getWalletAddress(algoraId) {
  const { data } = await supabase
    .from('users')
    .select('wallet_address, algora_id, name, role')
    .eq('algora_id', algoraId)
    .single();
  return data;
}

// ── PROPOSALS ────────────────────────────────────────────────

async function createProposal(proposalData) {
  const { data, error } = await supabase
    .from('proposals')
    .insert([proposalData])
    .select()
    .single();
  if (error) throw new Error('Could not create proposal: ' + error.message);
  return data;
}

async function getProposal(proposalId) {
  const { data } = await supabase
    .from('proposals')
    .select('*')
    .eq('proposal_id', proposalId)
    .single();
  return data;
}

async function updateProposalStatus(proposalId, status) {
  await supabase.from('proposals').update({ status }).eq('proposal_id', proposalId);
}

async function countProposals() {
  const { count } = await supabase
    .from('proposals')
    .select('*', { count: 'exact', head: true });
  return count || 0;
}

// ── MULTISIG ─────────────────────────────────────────────────

async function createMultisigWallet(walletData) {
  const { data, error } = await supabase
    .from('multisig_wallets')
    .insert([walletData])
    .select()
    .single();
  if (error) throw new Error('Could not create multisig: ' + error.message);
  return data;
}

async function getMultisigWallet(multisigAddress) {
  const { data } = await supabase
    .from('multisig_wallets')
    .select('*')
    .eq('multisig_address', multisigAddress)
    .single();
  return data;
}

async function addMultisigMember(memberData) {
  await supabase.from('multisig_members').insert([memberData]);
}

async function getMember(multisigAddress, memberAlgoraId) {
  const { data } = await supabase
    .from('multisig_members')
    .select('*')
    .eq('multisig_address', multisigAddress)
    .eq('member_algora_id', memberAlgoraId)
    .single();
  return data;
}

async function markMemberSigned(multisigAddress, memberAlgoraId) {
  await supabase
    .from('multisig_members')
    .update({ has_signed: true })
    .eq('multisig_address', multisigAddress)
    .eq('member_algora_id', memberAlgoraId);
}

async function getSignedCount(multisigAddress) {
  const { count } = await supabase
    .from('multisig_members')
    .select('*', { count: 'exact', head: true })
    .eq('multisig_address', multisigAddress)
    .eq('has_signed', true);
  return count || 0;
}

async function getAllMembers(multisigAddress) {
  const { data } = await supabase
    .from('multisig_members')
    .select('*')
    .eq('multisig_address', multisigAddress);
  return data || [];
}

async function getSignedMembers(multisigAddress) {
  const { data } = await supabase
    .from('multisig_members')
    .select('member_algora_id, member_wallet_address, users(encrypted_private_key)')
    .eq('multisig_address', multisigAddress)
    .eq('has_signed', true);
  return data || [];
}

async function getMilestones(proposalId) {
  const { data } = await supabase
    .from('proposals')
    .select('milestones')
    .eq('proposal_id', proposalId)
    .single();
  if (!data || !data.milestones) return [];
  return Array.isArray(data.milestones) ? data.milestones : [];
}

module.exports = {
  createUser, getUserByAlgoraId, getUserByEmail, countUsersByRole,
  getMilestones,
  saveOTP, verifyOTP,
  getWalletAddress,
  createProposal, getProposal, updateProposalStatus, countProposals,
  createMultisigWallet, getMultisigWallet,
  addMultisigMember, getMember, markMemberSigned,
  getSignedCount, getAllMembers, getSignedMembers
};