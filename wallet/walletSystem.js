// ============================================================
// walletSystem.js
// This is the heart of the wallet system.
// It automatically creates an Algorand wallet for every new user.
// You don't need to change anything in this file.
// ============================================================

const algosdk  = require('algosdk');
const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const nodemailer = require('nodemailer');

const { algodClient, ALGR_TOKEN_ID, ENCRYPTION_SECRET, EMAIL_USER, EMAIL_PASS } = require('./config');
const db = require('./database');

// ── EMAIL SENDER SETUP ───────────────────────────────────────
// This is what sends OTP emails to users
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS   // This is the App Password from Gmail, NOT your real password
  }
});

// ── HELPER: Lock the private key before saving ───────────────
// Private keys are NEVER stored as plain text. This locks them.
function encryptKey(text) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// ── HELPER: Unlock the private key when needed for a transaction ─
function decryptKey(encryptedText) {
  const [ivHex, encryptedHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString();
}

// ── HELPER: Build an Algora ID ───────────────────────────────
// Officials get:   GOV-MIN-0001, GOV-MIN-0002, etc.
// Contractors get: CON-0001, CON-0002, etc.
async function generateAlgoraId(role) {
  const count = await db.countUsersByRole(role);
  const number = String(count + 1).padStart(4, '0');
  return role === 'official' ? `GOV-MIN-${number}` : `CON-${number}`;
}

// ── MAIN: SIGN UP A NEW USER ─────────────────────────────────
// This is called when someone signs up for the first time.
// It creates their Algorand wallet automatically — they never see this happening.
//
// What it needs:
//   name     → "Rajiv Sharma"
//   email    → "rajiv@gov.in"
//   phone    → "9876543210"
//   password → "their chosen password"
//   role     → "official" or "contractor"
//
// What it returns:
//   algoraId       → their permanent Algora ID (e.g. GOV-MIN-0001)
//   walletAddress  → their permanent blockchain wallet address
//
async function signUpUser({ name, email, phone, password, role }) {

  // Check if this email is already registered
  const existing = await db.getUserByEmail(email);
  if (existing) throw new Error('This email is already registered.');

  // ── STEP 1: Create a brand-new Algorand wallet ───────────
  // One line. This is all it takes to make a blockchain wallet.
  const newAccount = algosdk.generateAccount();

  // ── STEP 2: Encrypt the private key before saving ────────
  const privateKeyBase64 = Buffer.from(newAccount.sk).toString('base64');
  const encryptedKey = encryptKey(privateKeyBase64);

  // ── STEP 3: Hash their password (NEVER store plain text) ─
  const passwordHash = await bcrypt.hash(password, 10);

  // ── STEP 4: Generate their Algora ID ─────────────────────
  const algoraId = await generateAlgoraId(role);

  // ── STEP 5: Save everything to Supabase ──────────────────
  await db.createUser({
    algora_id:             algoraId,
    name,
    email,
    phone,
    password_hash:         passwordHash,
    role,
    wallet_address:        newAccount.addr,   // public — safe
    encrypted_private_key: encryptedKey        // locked — safe
  });

  // ── STEP 6: Fund new wallet + opt into ALGR (background) ───
  // Runs silently after signup — user gets response instantly
  // Master wallet sends 0.01 ALGO, then wallet opts into ALGR
  fundAndOptIn(newAccount.addr.toString(), newAccount.sk).catch(e => {
    console.log('Background funding note:', e.message);
  });

  console.log(`New ${role} signed up: ${algoraId} → ${newAccount.addr.toString()}`);

  // Return ONLY safe info — never return private key
  return {
    success: true,
    algoraId,
    walletAddress: newAccount.addr.toString(),
    name,
    role,
    message: `Account created! Your Algora ID is ${algoraId}`
  };
}

// ── FUND NEW WALLET + OPT IN ──────────────────────────────────
// Runs automatically after every signup in the background.
// Step 1: Master wallet sends 0.01 ALGO to new wallet (enough for 10 transactions)
// Step 2: New wallet opts into ALGR token so it can receive tokens
async function fundAndOptIn(newAddress, newPrivateKey) {
  const fs = require('fs');
  const MASTER_FILE = './algora-master-wallet.json';

  if (!fs.existsSync(MASTER_FILE)) {
    console.log('Master wallet not found — skipping auto-fund');
    return;
  }

  const masterData    = JSON.parse(fs.readFileSync(MASTER_FILE));
  const masterAccount = algosdk.mnemonicToSecretKey(masterData.mnemonic);
  const masterAddress = masterData.address.toString();

  try {
    // ── Send 0.01 ALGO to new wallet ─────────────────────────
    // 10000 microALGO = 0.01 ALGO = enough for 10 transactions
    const params1 = await algodClient.getTransactionParams().do();
    const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender:          masterAddress,
      receiver:        newAddress,
      amount:          210000,
      note:            new Uint8Array(Buffer.from('Algora: new wallet funding')),
      suggestedParams: params1
    });
    const signedFund = fundTxn.signTxn(masterAccount.sk);
    const fundResult = await algodClient.sendRawTransaction(signedFund).do();
    const fundTxId   = fundResult.txId || fundResult.txid || String(fundResult);
    await algosdk.waitForConfirmation(algodClient, fundTxId, 4);
    console.log(`Funded ${newAddress} with 0.01 ALGO ✓`);

    // ── Opt new wallet into ALGR token ────────────────────────
    if (!ALGR_TOKEN_ID) return;
    const params2  = await algodClient.getTransactionParams().do();
    const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender:          newAddress,
      receiver:        newAddress,
      amount:          0,
      assetIndex:      ALGR_TOKEN_ID,
      suggestedParams: params2
    });
    const signedOpt = optInTxn.signTxn(newPrivateKey);
    const optResult = await algodClient.sendRawTransaction(signedOpt).do();
    const optTxId   = optResult.txId || optResult.txid || String(optResult);
    await algosdk.waitForConfirmation(algodClient, optTxId, 4);
    console.log(`Wallet ${newAddress} opted into ALGR ✓`);

  } catch (err) {
    console.log('Auto-fund error (non-critical):', err.message);
  }
}

// ── LOGIN ────────────────────────────────────────────────────
// Step 1 of 2: Check email + password, then send OTP
async function loginStep1({ email, password }) {

  // Find the user
  const user = await db.getUserByEmail(email);
  if (!user) throw new Error('No account found with this email.');

  // Check password
  const passwordCorrect = await bcrypt.compare(password, user.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password.');

  // Generate a 6-digit OTP
  const otpCode = String(Math.floor(100000 + Math.random() * 900000));

  // Save it to the database (expires in 10 minutes)
  await db.saveOTP(email, otpCode);

  // Send it by email
  await emailTransporter.sendMail({
    from: `"Algora" <${EMAIL_USER}>`,
    to: email,
    subject: 'Your Algora Login Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto;">
        <h2 style="color: #1a3a5c;">Algora — Login Verification</h2>
        <p>Hello ${user.name},</p>
        <p>Your one-time login code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; 
                    color: #1a3a5c; background: #f0f4f8; 
                    padding: 20px; text-align: center; border-radius: 8px;">
          ${otpCode}
        </div>
        <p style="color: #888; font-size: 12px;">This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
    `
  });

  console.log(`OTP sent to ${email}`);
  return { success: true, message: 'OTP sent to your email.' };
}

// ── VERIFY OTP ───────────────────────────────────────────────
// Step 2 of 2: Check the OTP, return user info if correct
async function loginStep2({ email, otpCode }) {

  const otpCorrect = await db.verifyOTP(email, otpCode);
  if (!otpCorrect) throw new Error('Wrong or expired OTP. Please try again.');

  // Get user info to return
  const user = await db.getUserByEmail(email);

  // Return safe info only
  return {
    success: true,
    algoraId:      user.algora_id,
    name:          user.name,
    role:          user.role,
    walletAddress: user.wallet_address,
    // PASSWORD and PRIVATE KEY are NEVER returned
  };
}

// ── GET WALLET INFO ──────────────────────────────────────────
// Returns the data shown in the wallet popup:
// wallet address, token balance, transaction count
async function getWalletInfo(algoraId) {

  const user = await db.getUserByAlgoraId(algoraId);
  if (!user) throw new Error('User not found.');

  let tokenBalance = 0;
  let totalTransactions = 0;

  try {
    // Ask Algorand about this wallet's current state
    const accountInfo = await algodClient.accountInformation(user.wallet_address).do();

    // Find the ALGR token balance specifically
    if (ALGR_TOKEN_ID && accountInfo.assets) {
      const algrAsset = accountInfo.assets.find(a => a['asset-id'] === ALGR_TOKEN_ID);
      tokenBalance = algrAsset ? algrAsset.amount : 0;
    }

    // Transaction count comes from the Algorand network too
    totalTransactions = accountInfo['total-apps-opted-in'] || 0;

  } catch (err) {
    // If Algorand is unreachable, just show zeros — no crash
    console.log('Could not fetch live balance (showing 0):', err.message);
  }

  return {
    algoraId:          user.algora_id,
    name:              user.name,
    role:              user.role,
    walletAddress:     user.wallet_address,
    tokenBalance,        // number of ALGR tokens
    totalTransactions,   // number of transactions
    // PRIVATE KEY is NEVER returned here
  };
}

// ── SEND ALGR TOKENS ─────────────────────────────────────────
// Transfer ALGR tokens from one official to another
async function sendALGR({ senderAlgoraId, senderPassword, recipientAddress, amount }) {

  const sender = await db.getUserByAlgoraId(senderAlgoraId);
  if (!sender) throw new Error('Sender not found.');

  // Verify password before ANY transaction
  const passwordCorrect = await bcrypt.compare(senderPassword, sender.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password. Transaction cancelled.');

  // Decrypt the private key just long enough to sign
  const privateKeyBase64 = decryptKey(sender.encrypted_private_key);
  const privateKey = Buffer.from(privateKeyBase64, 'base64');

  const params = await algodClient.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from:          sender.wallet_address,
    to:            recipientAddress,
    amount,
    assetIndex:    ALGR_TOKEN_ID,
    note:          new Uint8Array(Buffer.from(`Algora: ${senderAlgoraId} → ${recipientAddress}`)),
    suggestedParams: params,
  });

  const signedTxn = txn.signTxn(privateKey);
  const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
  await algosdk.waitForConfirmation(algodClient, txId, 4);

  return {
    success: true,
    txHash: txId,
    amount,
    from: sender.wallet_address,
    to:   recipientAddress,
    explorerLink: `https://testnet.algoexplorer.io/tx/${txId}`
  };
}

module.exports = { signUpUser, loginStep1, loginStep2, getWalletInfo, sendALGR, decryptKey };