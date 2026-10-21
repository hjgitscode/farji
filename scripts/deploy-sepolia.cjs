// Deploys FarjiRegistry to SEPOLIA ONLY (ROADMAP Phase 15). Ethereum mainnet is refused.
//
// Prerequisites (see docs/DEPLOYMENT.md):
//   FARJI_RPC_URL             a Sepolia JSON-RPC URL (server-side only; never commit it)
//   FARJI_ADMIN_WALLET        the PUBLIC address of the Admin MetaMask wallet (platform admin)
//   FARJI_DEFAULT_ADMIN       optional PUBLIC address that may grant/revoke the platform-admin role (defaults to FARJI_ADMIN_WALLET)
//   FARJI_ADMIN_DELAY_SECONDS optional, minimum 86400 (default 86400)
//   a deployer keystore created with `npm run chain:keystore -- new` and funded with Sepolia test ETH
//
// The deployer key is decrypted in memory for this run only and is never printed or stored. After deployment the deployer
// holds NO role in the contract: authority belongs to the wallets named above.
const fs = require("node:fs");
const path = require("node:path");
const { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, getAddress, isAddress, keccak256 } = require("ethers");
require("./env-load.cjs");
const { ask } = require("./prompt.cjs");

const SEPOLIA = 11155111n;
const root = path.join(__dirname, "..");

function need(name, value) {
  const v = (value || "").trim();
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

async function main() {
  const rpc = need("FARJI_RPC_URL", process.env.FARJI_RPC_URL);
  const admin = need("FARJI_ADMIN_WALLET", process.env.FARJI_ADMIN_WALLET);
  if (!isAddress(admin)) throw new Error("FARJI_ADMIN_WALLET must be a valid address (a public address, never a key).");
  const defaultAdmin = (process.env.FARJI_DEFAULT_ADMIN || admin).trim();
  if (!isAddress(defaultAdmin)) throw new Error("FARJI_DEFAULT_ADMIN must be a valid address.");
  const delay = Number(process.env.FARJI_ADMIN_DELAY_SECONDS || "86400");
  if (!Number.isInteger(delay) || delay < 86400) throw new Error("FARJI_ADMIN_DELAY_SECONDS must be an integer of at least 86400 on a public network.");

  const provider = new JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  if (network.chainId === 1n) throw new Error("This RPC is Ethereum MAINNET. FARJI is deployed to Sepolia only. Aborting.");
  if (network.chainId !== SEPOLIA) throw new Error(`This RPC is chain ${network.chainId}, not Sepolia (${SEPOLIA}). Aborting.`);

  const keystore = path.resolve(process.env.FARJI_DEPLOYER_KEYSTORE || path.join(root, ".keystore", "deployer.json"));
  if (!fs.existsSync(keystore)) throw new Error("No deployer keystore found. Run: npm run chain:keystore -- new");
  const password = await ask("Keystore password (hidden): ", { hidden: true });
  const deployer = (await Wallet.fromEncryptedJson(fs.readFileSync(keystore, "utf8"), password)).connect(provider);

  const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", "FarjiRegistry.sol", "FarjiRegistry.json"), "utf8"));
  const balance = await provider.getBalance(deployer.address);
  console.log("\nPlan");
  console.log(`  network:        Sepolia (${network.chainId})`);
  console.log(`  deployer:       ${deployer.address} (balance ${formatEther(balance)} ETH)`);
  console.log(`  platform admin: ${getAddress(admin)}`);
  console.log(`  default admin:  ${getAddress(defaultAdmin)}`);
  console.log(`  admin delay:    ${delay}s`);
  if (balance === 0n) throw new Error("The deployer has no Sepolia ETH. Fund it from a faucet and run this again.");
  if (getAddress(defaultAdmin) === deployer.address || getAddress(admin) === deployer.address) {
    console.log("  note: the deployer is also an admin; prefer separate wallets so the deployer key holds no authority.");
  }
  const confirm = (await ask('\nType "deploy to sepolia" to continue: ')).trim();
  if (confirm !== "deploy to sepolia") throw new Error("Cancelled. Nothing was sent.");

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(delay, defaultAdmin, admin);
  const deployTx = contract.deploymentTransaction();
  console.log(`Submitted ${deployTx.hash}; waiting for it to be mined...`);
  await contract.waitForDeployment();
  const receipt = await deployTx.wait(2);
  const address = (await contract.getAddress()).toLowerCase();

  // Read-only verification of what was deployed.
  const registry = new Contract(address, artifact.abi, provider);
  const platformRole = await registry.PLATFORM_ADMIN_ROLE();
  const code = await provider.getCode(address);
  const checks = {
    "code present": code !== "0x",
    "platform admin holds PLATFORM_ADMIN_ROLE": await registry.hasRole(platformRole, admin),
    "default admin is as configured": getAddress(await registry.defaultAdmin()) === getAddress(defaultAdmin),
    "deployer holds no platform role": !(await registry.hasRole(platformRole, deployer.address)) || getAddress(admin) === deployer.address,
    "runtime code matches this build": keccak256(code) === keccak256(artifact.deployedBytecode),
  };
  for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);

  const record = {
    network: "sepolia",
    chainId: Number(network.chainId),
    registry: address,
    transactionHash: deployTx.hash,
    blockNumber: receipt.blockNumber,
    deployer: deployer.address,
    platformAdmin: getAddress(admin),
    defaultAdmin: getAddress(defaultAdmin),
    adminDelaySeconds: delay,
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(root, "deployments"), { recursive: true });
  fs.writeFileSync(path.join(root, "deployments", "sepolia.json"), JSON.stringify(record, null, 2) + "\n");

  console.log(`\nFarjiRegistry deployed on Sepolia\n  address: ${address}\n  tx:      ${deployTx.hash}\n  block:   ${receipt.blockNumber}`);
  console.log("\nSet these in Vercel (Production) and in your local .env.local:");
  console.log(`  FARJI_CHAIN_ID=11155111\n  FARJI_REGISTRY_ADDRESS=${address}\n  FARJI_FINALITY=finalized`);
  console.log("\nThen verify the wiring read-only:  npm run chain:check");
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
