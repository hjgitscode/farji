// Read-only check that FARJI's configuration points at a real, correct registry (no keys, sends nothing).
//   FARJI_RPC_URL, FARJI_CHAIN_ID, FARJI_REGISTRY_ADDRESS   (and optionally FARJI_ADMIN_WALLET)
// Exit code 0 only if every check passes. Used after deployment and by the integration tests.
const fs = require("node:fs");
const path = require("node:path");
const { Contract, JsonRpcProvider, getAddress, isAddress, keccak256 } = require("ethers");
require("./env-load.cjs");

const SUPPORTED = [31337n, 1337n, 11155111n];
const PUBLIC = [11155111n];

async function main() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const rpc = (process.env.FARJI_RPC_URL || "").trim();
  const chainRaw = (process.env.FARJI_CHAIN_ID || "").trim();
  const registry = (process.env.FARJI_REGISTRY_ADDRESS || "").trim();
  const admin = (process.env.FARJI_ADMIN_WALLET || "").trim();
  const finality = (process.env.FARJI_FINALITY || "finalized").trim();

  check("FARJI_RPC_URL is set", /^https?:\/\//.test(rpc));
  check("FARJI_CHAIN_ID is a supported network", /^[1-9][0-9]*$/.test(chainRaw) && SUPPORTED.includes(BigInt(chainRaw)), "Sepolia 11155111 or a local network; mainnet is not supported");
  check("FARJI_REGISTRY_ADDRESS is a valid address", isAddress(registry));
  const configured = /^[1-9][0-9]*$/.test(chainRaw) ? BigInt(chainRaw) : 0n;
  check("finality policy fits the network", PUBLIC.includes(configured) ? finality === "finalized" : /^(finalized|depth:\d+)$/.test(finality), 'public networks require "finalized"');

  if (results.every((r) => r.ok)) {
    try {
      const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: false });
      const reported = BigInt(await provider.send("eth_chainId", []));
      check("the node reports the configured chain id", reported === configured, `node says ${reported}`);
      const code = await provider.getCode(registry);
      check("a contract exists at the registry address", code !== "0x");
      const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "FarjiRegistry.sol", "FarjiRegistry.json");
      if (fs.existsSync(artifactPath) && code !== "0x") {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        check("the deployed code is this repository's FarjiRegistry", keccak256(code) === keccak256(artifact.deployedBytecode));
        const c = new Contract(registry, artifact.abi, provider);
        if (isAddress(admin)) check("FARJI_ADMIN_WALLET holds PLATFORM_ADMIN_ROLE", await c.hasRole(await c.PLATFORM_ADMIN_ROLE(), getAddress(admin)));
        check("the registry answers a read call", typeof (await c.defaultAdminDelay()) === "bigint");
      }
      if (PUBLIC.includes(configured)) {
        const fin = await provider.send("eth_getBlockByNumber", ["finalized", false]);
        const head = await provider.send("eth_blockNumber", []);
        check('the node supports the "finalized" block tag', !!fin && !!fin.number, "required for Sepolia finality");
        if (fin && fin.number) console.log(`  head ${parseInt(head, 16)}, finalized ${parseInt(fin.number, 16)} (finality normally trails the head by a few minutes)`);
      }
    } catch (e) {
      check("the node could be queried", false, String(e.message).slice(0, 120));
    }
  }
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
