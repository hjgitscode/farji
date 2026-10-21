// Local, encrypted deployer keystore for the Sepolia deployment (ROADMAP Phase 15).
//
//   npm run chain:keystore -- new       create a FRESH deployer wallet and save it encrypted (prints the ADDRESS only)
//   npm run chain:keystore -- import    encrypt an existing private key you paste at a hidden prompt
//   npm run chain:keystore -- address   print the saved wallet address (no password needed)
//
// The file lives in .keystore/ (git-ignored). The password and any key you type are never echoed, logged or stored in
// plaintext; the FARJI application never reads this file and never sees a private key. Use a throw-away deployer: after
// deployment it holds NO authority (the contract admin is the wallet you name in FARJI_ADMIN_WALLET / FARJI_DEFAULT_ADMIN).
const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");
require("./env-load.cjs");
const { ask } = require("./prompt.cjs");

const file = path.resolve(process.env.FARJI_DEPLOYER_KEYSTORE || path.join(__dirname, "..", ".keystore", "deployer.json"));

async function save(wallet) {
  const password = await ask("Choose a keystore password (hidden): ", { hidden: true });
  if (password.length < 12) throw new Error("Use a password of at least 12 characters.");
  if (password !== (await ask("Repeat the password (hidden): ", { hidden: true }))) throw new Error("The passwords do not match.");
  console.log("Encrypting (this takes a few seconds)...");
  const json = await wallet.encrypt(password);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, json, { mode: 0o600, flag: "wx" });
  console.log(`Saved ${path.relative(process.cwd(), file)}\nDeployer address (fund this with Sepolia test ETH): ${wallet.address}`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "address") {
    const { address } = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(address.startsWith("0x") ? address : `0x${address}`);
  } else if (cmd === "new") {
    if (fs.existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite it.`);
    await save(Wallet.createRandom());
  } else if (cmd === "import") {
    if (fs.existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite it.`);
    const key = (await ask("Paste the private key (hidden): ", { hidden: true })).trim();
    await save(new Wallet(key.startsWith("0x") ? key : `0x${key}`));
  } else {
    console.log("Usage: npm run chain:keystore -- new | import | address");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
