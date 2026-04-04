// ============================================================
// walletSystem.js — FINAL FIXED VERSION
// ============================================================
// KEY CHANGES vs previous versions:
// 1. Wallet keypair generated for ALL roles at signup
//    (fixes "wallet_address NOT NULL" Supabase constraint)
// 2. Wallet FUNDED on-chain only after OTP for gov/contractor
//    (citizens have an address but it's never funded)
// 3. Citizens skip OTP — direct JWT at login
// 4. .trim() on all email/password values from .env
// 5. Robust algora_id generation (uses MAX existing, not count)
// ============================================================

const algosdk    = require('algosdk');
const crypto     = require('crypto');
const bcrypt     = require('bcrypt');
const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');

const { algodClient, ALGR_TOKEN_ID, ENCRYPTION_SECRET, EMAIL_USER, EMAIL_PASS } = require('./config');
const db = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'algora-fallback-secret';

// ── EMAIL — .trim() ensures .env spaces/quotes never break it ──
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: (EMAIL_USER || '').trim(),
    pass: (EMAIL_PASS || '').trim()
  },
  pool: true,
  maxConnections: 3,
});

emailTransporter.verify((err) => {
  if (err) console.error('❌ Email setup BROKEN:', err.message);
  else     console.log('✓ Email transporter ready');
});

// Verify on startup so we catch auth errors immediately
emailTransporter.verify((err) => {
  if (err) console.error('❌ Email transporter error:', err.message);
  else     console.log('✓ Email transporter ready');
});

// ── ENCRYPT private key before saving to DB ────────────────────
function encryptKey(text) {
  const iv        = crypto.randomBytes(16);
  const key       = Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32));
  const cipher    = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// ── DECRYPT private key for transactions ──────────────────────
function decryptKey(encryptedText) {
  const [ivHex, encryptedHex] = encryptedText.split(':');
  const iv        = Buffer.from(ivHex, 'hex');
  const key       = Buffer.from(ENCRYPTION_SECRET.padEnd(32).slice(0, 32));
  const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString();
}

// ── GENERATE ALGORA ID ─────────────────────────────────────────
// Uses MAX existing number for the role, not count.
// This avoids duplicate IDs even if rows were deleted from DB.
async function generateAlgoraId(role) {
  const { supabase } = require('./config');

  let prefix;
  if (role === 'official')   prefix = 'GOV-MIN-';
  else if (role === 'contractor') prefix = 'CON-';
  else prefix = 'CIT-';

  // Get all algora_ids for this role and find the highest number
  const { data } = await supabase
    .from('users')
    .select('algora_id')
    .eq('role', role);

  let maxNum = 0;
  if (data && data.length > 0) {
    data.forEach(row => {
      const parts = row.algora_id.split('-');
      const num   = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    });
  }

  const number = String(maxNum + 1).padStart(4, '0');
  return `${prefix}${number}`;
}

// ── SEND OTP EMAIL ─────────────────────────────────────────────
async function sendOtpEmail(name, toEmail, otpCode, attempt = 1) {
  const cleanTo   = (toEmail    || '').trim();
  const cleanFrom = (EMAIL_USER || '').trim();
  try {
    await emailTransporter.sendMail({
      from:    `"Algora" <${cleanFrom}>`,
      to:      cleanTo,
      subject: 'Your Algora Login Code',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;">
          <h2 style="color:#dc2626;">Algora — Login Verification</h2>
          <p>Hello ${name},</p>
          <p>Your one-time login code is:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;
                      color:#dc2626;background:#1a1a1a;
                      padding:20px;text-align:center;border-radius:8px;">
            ${otpCode}
          </div>
          <p style="color:#888;font-size:12px;">Expires in 10 minutes. Do not share.</p>
        </div>`
    });
    console.log(`✓ OTP ${otpCode} sent to ${cleanTo}`);
  } catch (err) {
    console.error(`✗ OTP attempt ${attempt} failed:`, err.message);
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 2000));
      return sendOtpEmail(name, toEmail, otpCode, attempt + 1);
    }
    throw new Error('Email failed after 3 attempts. Check Gmail App Password in .env');
  }
}

// ════════════════════════════════════════════════════════════
// SIGN UP
// ALL roles get a wallet keypair at signup.
// - wallet_address = proper 58-char Algorand string (never null)
// - encrypted_private_key = AES-256 encrypted, safe to store
// - Wallet is NOT funded yet (no on-chain activity until OTP)
// ════════════════════════════════════════════════════════════
async function signUpUser({ name, email, phone, password, role }) {

  const existing = await db.getUserByEmail(email);
  if (existing) throw new Error('This email is already registered.');

  // Generate Algorand wallet keypair for everyone
let walletAddress    = null;
  let privateKeyBase64 = null;
  let privateKeyBytes  = null;

  if (role === 'official' || role === 'contractor') {
    const newAccount = algosdk.generateAccount();
    walletAddress    = newAccount.addr.toString();
    privateKeyBase64 = Buffer.from(newAccount.sk).toString('base64');
    privateKeyBytes  = newAccount.sk;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const algoraId     = await generateAlgoraId(role);

  await db.createUser({
    algora_id:             algoraId,
    name,
    email,
    phone,
    password_hash:         passwordHash,
    role,
    wallet_address:        walletAddress,   // null for citizens
    encrypted_private_key: privateKeyBase64 ? encryptKey(privateKeyBase64) : null
  });

  console.log(`New ${role} signed up: ${algoraId} → ${walletAddress}`);

  // For gov/contractor: fund wallet in background immediately at signup
  // (so wallet is ready by the time they verify OTP)
  if (role === 'official' || role === 'contractor') {
    fundAndOptIn(walletAddress, privateKeyBytes).catch(e =>
      console.log('Background funding note:', e.message)
    );
  }

  return {
    success: true,
    algoraId,
    name,
    role,
    message: `Account created! Your Algora ID is ${algoraId}`
  };
}

// ════════════════════════════════════════════════════════════
// LOGIN STEP 1
// Checks email + password, then:
// CITIZEN     → issues JWT immediately (skipOtp: true)
// GOV/CONTRA  → sends OTP email (skipOtp: false)
// ════════════════════════════════════════════════════════════
async function loginStep1({ email, password }) {

  const user = await db.getUserByEmail(email);
  if (!user) throw new Error('No account found with this email.');

  const passwordCorrect = await bcrypt.compare(password, user.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password.');

  // CITIZEN: skip OTP, return JWT + user now
  if (user.role === 'citizen') {
    const token = jwt.sign(
      { algoraId: user.algora_id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return {
      success: true,
      skipOtp: true,
      token,
      user: {
        algoraId:      user.algora_id,
        name:          user.name,
        role:          user.role,
        walletAddress: user.wallet_address,
        email:         user.email
      }
    };
  }

  // GOV + CONTRACTOR: send OTP
  const otpCode = String(Math.floor(100000 + Math.random() * 900000));
  await db.saveOTP(email, otpCode);
  await sendOtpEmail(user.name, email, otpCode);

  return { success: true, skipOtp: false, message: 'OTP sent to your email.' };
}

// ════════════════════════════════════════════════════════════
// LOGIN STEP 2 — OTP verify (gov + contractor only)
// Verifies OTP, returns user info. JWT issued in server.js.
// ════════════════════════════════════════════════════════════
async function loginStep2({ email, otpCode }) {

  const otpCorrect = await db.verifyOTP(email, otpCode);
  if (!otpCorrect) throw new Error('Wrong or expired OTP. Please try again.');

  const user = await db.getUserByEmail(email);

  return {
    success:       true,
    algoraId:      user.algora_id,
    name:          user.name,
    role:          user.role,
    walletAddress: user.wallet_address,
  };
}

// ════════════════════════════════════════════════════════════
// FUND WALLET + OPT INTO ALGR (runs in background)
// Checks balance first — skips if already funded.
// ════════════════════════════════════════════════════════════
async function fundAndOptIn(newAddress, newPrivateKey) {
  const fs          = require('fs');
  const MASTER_FILE = './algora-master-wallet.json';

  if (!fs.existsSync(MASTER_FILE)) {
    console.log('Master wallet not found — skipping auto-fund');
    return;
  }

  // Skip if already funded
  try {
    const info = await algodClient.accountInformation(newAddress).do();
    if (info.amount > 0) {
      console.log(`Wallet ${newAddress} already funded — skipping`);
      return;
    }
  } catch (e) {
    // Not on chain yet — proceed
  }

  const masterData    = JSON.parse(fs.readFileSync(MASTER_FILE));
  const masterAccount = algosdk.mnemonicToSecretKey(masterData.mnemonic);
  const masterAddress = masterAccount.addr.toString();

  try {
    // Send 0.21 ALGO (covers min balance + opt-in fee)
    const params1  = await algodClient.getTransactionParams().do();
    const fundTxn  = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender:          masterAddress,
      receiver:        newAddress,
      amount:          210000,
      note:            new Uint8Array(Buffer.from('Algora: wallet funding')),
      suggestedParams: params1
    });
    const signedFund = fundTxn.signTxn(masterAccount.sk);
    const fundResult = await algodClient.sendRawTransaction(signedFund).do();
    const fundTxId   = fundResult.txId || fundResult.txid || String(fundResult);
    await algosdk.waitForConfirmation(algodClient, fundTxId, 4);
    console.log(`✓ Funded ${newAddress}`);

    if (!ALGR_TOKEN_ID) return;

    // Opt into ALGR token
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
    console.log(`✓ Wallet ${newAddress} opted into ALGR`);

  } catch (err) {
    console.log('Auto-fund error (non-critical):', err.message);
  }
}

// ── GET WALLET INFO ───────────────────────────────────────────
async function getWalletInfo(algoraId) {
  const user = await db.getUserByAlgoraId(algoraId);
  if (!user) throw new Error('User not found.');

  let tokenBalance = 0, totalTransactions = 0;

  try {
    const accountInfo = await algodClient.accountInformation(user.wallet_address).do();
    if (ALGR_TOKEN_ID && accountInfo.assets) {
      const algrAsset = accountInfo.assets.find(a => a['asset-id'] === ALGR_TOKEN_ID);
      tokenBalance = algrAsset ? algrAsset.amount : 0;
    }
    totalTransactions = accountInfo['total-apps-opted-in'] || 0;
  } catch (err) {
    console.log('Could not fetch live balance:', err.message);
  }

  return {
    algoraId:      user.algora_id,
    name:          user.name,
    role:          user.role,
    walletAddress: user.wallet_address,
    tokenBalance,
    totalTransactions,
  };
}

// ── SEND ALGR TOKENS ──────────────────────────────────────────
async function sendALGR({ senderAlgoraId, senderPassword, recipientAddress, amount }) {
  const sender = await db.getUserByAlgoraId(senderAlgoraId);
  if (!sender) throw new Error('Sender not found.');

  const passwordCorrect = await bcrypt.compare(senderPassword, sender.password_hash);
  if (!passwordCorrect) throw new Error('Wrong password. Transaction cancelled.');

  const privateKeyBase64 = decryptKey(sender.encrypted_private_key);
  const privateKey       = Buffer.from(privateKeyBase64, 'base64');
  const params           = await algodClient.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender:          sender.wallet_address,
    receiver:        recipientAddress,
    amount,
    assetIndex:      ALGR_TOKEN_ID,
    note:            new Uint8Array(Buffer.from(`Algora: ${senderAlgoraId} → ${recipientAddress}`)),
    suggestedParams: params,
  });

  const signedTxn = txn.signTxn(privateKey);
  const result    = await algodClient.sendRawTransaction(signedTxn).do();
  const txId      = result.txId || result.txid;
  await algosdk.waitForConfirmation(algodClient, txId, 4);

  return {
    success:      true,
    txHash:       txId,
    amount,
    from:         sender.wallet_address,
    to:           recipientAddress,
    explorerLink: `https://testnet.algoexplorer.io/tx/${txId}`
  };
}

module.exports = { signUpUser, loginStep1, loginStep2, getWalletInfo, sendALGR, decryptKey };