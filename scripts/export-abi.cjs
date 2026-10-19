// Exports the compiled FarjiRegistry ABI into lib/blockchain so the app and the browser never
// depend on the Hardhat artifacts folder. Run after `npm run compile`:  npm run chain:abi
const fs = require("node:fs");
const path = require("node:path");

const artifact = path.join(__dirname, "..", "artifacts", "contracts", "FarjiRegistry.sol", "FarjiRegistry.json");
const target = path.join(__dirname, "..", "lib", "blockchain", "farji-registry.abi.json");

if (!fs.existsSync(artifact)) {
  console.error("Artifact not found. Run `npm run compile` first.");
  process.exit(1);
}
const { abi } = JSON.parse(fs.readFileSync(artifact, "utf8"));
fs.writeFileSync(target, JSON.stringify(abi, null, 2) + "\n");
console.log(`Wrote ${abi.length} ABI entries to ${path.relative(process.cwd(), target)}`);
