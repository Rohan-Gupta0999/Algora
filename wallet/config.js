// ============================================================
// config.js
// ALL your credentials live here.
// When your friend gives you the Supabase details, paste them below.
// ============================================================
require('dotenv').config();


const algosdk = require('algosdk');
const { createClient } = require('@supabase/supabase-js');


// ── 1. ALGORAND CONNECTION ───────────────────────────────────
// This connects to the FREE test network (Testnet)
// No real money, perfect for building and testing
const algodClient = new algosdk.Algodv2(
  '',                                    // Leave this empty
  'https://testnet-api.algonode.cloud', // Free testnet server
  443,
  { timeout: 10000 }
);

// ── 2. SUPABASE CONNECTION ───────────────────────────────────
// Ask your friend who made the Supabase account for these two values.
// They can find them at: supabase.com → their project → Settings → API
const SUPABASE_URL     = process.env.SUPABASE_URL;
// Example: 'https://abcdefghijk.supabase.co'

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' (very long string)

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// this line above creates a "supabase" object we can use to talk to the database in other files
// it basically connects backened to the database using the URL and KEY you provided

// ── 3. YOUR ALGR TOKEN ID ────────────────────────────────────
// You will get this after running mintToken.js ONE TIME.
// Leave it as null for now. Fill it in after you create your token.
const ALGR_TOKEN_ID = 757439981;

// ── 4. ENCRYPTION SECRET ─────────────────────────────────────
// This is used to lock private keys before saving them to the database.
// Change it to any long random phrase. NEVER share this. NEVER put it on GitHub.
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

// ── 5. EMAIL SETTINGS (for OTP) ──────────────────────────────
// Algora will send OTP emails from this Gmail address.
// Step 1: Use a Gmail account for Algora (create a new one if needed)
// Step 2: Turn on "App Passwords" in that Gmail account:
//         Gmail → Google Account → Security → 2-Step Verification → App Passwords
//         Generate a password for "Mail" and paste it below as EMAIL_PASS
const EMAIL_USER = process.env.EMAIL_USER;  // The Gmail address
const EMAIL_PASS = process.env.EMAIL_PASS;           // The 16-character App Password (not your real Gmail password)

// ── 6. SERVER PORT ───────────────────────────────────────────
// The port your backend server will run on.
// When you click "Go Live" in VS Code, it runs on this port.
const PORT = 3000;

module.exports = {
  algodClient,
  supabase,
  ALGR_TOKEN_ID,
  ENCRYPTION_SECRET,
  EMAIL_USER,
  EMAIL_PASS,
  PORT
};