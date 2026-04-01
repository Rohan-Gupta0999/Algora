// ============================================================
// mintToken.js  —  Compatible with algosdk v2
// node mintToken.js setup    → create master wallet
// node mintToken.js create   → create ALGR token
// node mintToken.js mint 50000000  → mint more tokens
// node mintToken.js balance  → check balance
// ============================================================

const algosdk = require('algosdk');
const fs      = require('fs');

const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);

let ALGR_TOKEN_ID = null;
try { const config = require('./config'); ALGR_TOKEN_ID = config.ALGR_TOKEN_ID; } catch(e) {}

const MASTER_WALLET_FILE = './algora-master-wallet.json';

const command = process.argv[2];
const amount  = parseInt(process.argv[3]);

if      (command === 'setup')   setupMasterWallet();
else if (command === 'create')  createALGRToken();
else if (command === 'mint')    mintMoreTokens(amount);
else if (command === 'balance') checkBalance();
else {
  console.log('\nALGORA TOKEN MANAGEMENT\n=======================');
  console.log('node mintToken.js setup            → Step 1: create master wallet');
  console.log('node mintToken.js create           → Step 2: create ALGR token');
  console.log('node mintToken.js mint 50000000    → mint 50 lakh tokens');
  console.log('node mintToken.js balance          → check balance\n');
}

async function setupMasterWallet() {
  if (fs.existsSync(MASTER_WALLET_FILE)) {
    console.log('\nMaster wallet already exists:', MASTER_WALLET_FILE);
    console.log('Delete it first if you want to start fresh.\n');
    return;
  }
  const account  = algosdk.generateAccount();
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  const address  = account.addr.toString();
  fs.writeFileSync(MASTER_WALLET_FILE, JSON.stringify({ address, mnemonic, created: new Date().toISOString() }, null, 2));
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║         ALGORA MASTER WALLET CREATED             ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log('Public Address:\n' + address + '\n');
  console.log('Saved to:', MASTER_WALLET_FILE);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('NEXT STEP: Fund this wallet');
  console.log('1. Go to: https://bank.testnet.algorand.network');
  console.log('2. Paste address:', address);
  console.log('3. Click Dispense, wait 10 seconds');
  console.log('4. Then run: node mintToken.js create');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function createALGRToken() {
  const master = loadMasterWallet();
  if (!master) return;
  const addr = master.address.toString();
  console.log('\nCreating ALGR token...\nUsing wallet:', addr, '\n');
  try {
    const account = algosdk.mnemonicToSecretKey(master.mnemonic);
    const params  = await algodClient.getTransactionParams().do();

    const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      sender:          addr,
      assetName:       'Algora Rupee',
      unitName:        'ALGR',
      total:           100000000000000,
      decimals:        0,
      manager:         addr,
      reserve:         addr,
      freeze:          addr,
      clawback:        addr,
      defaultFrozen:   false,
      suggestedParams: params
    });

    const signedTxn  = txn.signTxn(account.sk);
    const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
    const txId       = sendResult.txId || sendResult.txid || String(sendResult);

    console.log('Transaction sent! Waiting ~4 seconds for confirmation...');
    const result  = await algosdk.waitForConfirmation(algodClient, txId, 4);
    const tokenId = result['asset-index'] ?? result['assetIndex'];

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║              ALGR TOKEN CREATED!                 ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    console.log('Token ID :', tokenId);
    console.log('Name     : Algora Rupee');
    console.log('Symbol   : ALGR');
    console.log('Supply   : 10 lakh crore ALGR');
    console.log('Rate     : 1 ALGR = ₹1\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('NEXT STEP: Open config.js and change:');
    console.log('  const ALGR_TOKEN_ID = null;');
    console.log('to:');
    console.log(`  const ALGR_TOKEN_ID = ${tokenId};`);
    console.log('Then restart server: node server.js');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nView: https://testnet.algoexplorer.io/asset/${tokenId}\n`);

    const walletData = JSON.parse(fs.readFileSync(MASTER_WALLET_FILE));
    walletData.tokenId = tokenId;
    fs.writeFileSync(MASTER_WALLET_FILE, JSON.stringify(walletData, null, 2));

  } catch (err) {
    console.log('\nERROR:', err.message, '\n');
    if (err.message.includes('overspend') || err.message.includes('fund')) {
      console.log('Wallet not funded. Go to: https://bank.testnet.algorand.network\n');
    }
  }
}

async function mintMoreTokens(amountToMint) {
  if (!amountToMint || isNaN(amountToMint) || amountToMint <= 0) {
    console.log('\nExample: node mintToken.js mint 50000000  (= ₹50 lakh)\n'); return;
  }
  if (!ALGR_TOKEN_ID) {
    console.log('\nERROR: ALGR_TOKEN_ID not set in config.js\nRun create first.\n'); return;
  }
  const master = loadMasterWallet();
  if (!master) return;
  const addr = master.address.toString();
  console.log(`\nMinting ${amountToMint.toLocaleString('en-IN')} ALGR tokens...`);
  try {
    const account = algosdk.mnemonicToSecretKey(master.mnemonic);
    const params  = await algodClient.getTransactionParams().do();
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: addr, receiver: addr, amount: amountToMint,
      assetIndex: ALGR_TOKEN_ID,
      note: new Uint8Array(Buffer.from(`Algora mint ${new Date().toISOString()}`)),
      suggestedParams: params
    });
    const signedTxn  = txn.signTxn(account.sk);
    const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
    const txId       = sendResult.txId || sendResult.txid || String(sendResult);
    await algosdk.waitForConfirmation(algodClient, txId, 4);
    console.log(`\n✓ Minted ${amountToMint.toLocaleString('en-IN')} ALGR = ₹${amountToMint.toLocaleString('en-IN')}`);
    console.log('Tokens are in your master wallet.\n');
  } catch (err) { console.log('ERROR:', err.message); }
}

async function checkBalance() {
  const master = loadMasterWallet();
  if (!master) return;
  const addr = master.address.toString();
  try {
    const info = await algodClient.accountInformation(addr).do();
    console.log('\nALGORA MASTER WALLET\n════════════════════');
    console.log('Address :', addr);
    console.log('ALGO    :', (Number(info.amount) / 1000000).toFixed(4), 'ALGO (for fees)');
    if (ALGR_TOKEN_ID && info.assets) {
      const a = info.assets.find(a => (a['asset-id'] ?? a.assetId) === ALGR_TOKEN_ID);
      const b = a ? Number(a.amount) : 0;
      console.log(`ALGR    : ${b.toLocaleString('en-IN')} ALGR = ₹${b.toLocaleString('en-IN')}`);
    }
    console.log('');
  } catch (err) { console.log('ERROR:', err.message); }
}

function loadMasterWallet() {
  if (!fs.existsSync(MASTER_WALLET_FILE)) {
    console.log('\nERROR: Master wallet not found. Run: node mintToken.js setup\n');
    return null;
  }
  return JSON.parse(fs.readFileSync(MASTER_WALLET_FILE));
}