import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import type { TestProject } from "vitest/node";
import { HARDHAT_ACCOUNT_0_KEY } from "../fixtures/test-wallets";

// Starts a real local Hardhat node and deploys the real FarjiRegistry for the integration tests.
// The node is private to the test run (own port, torn down afterwards). Account #0 is Hardhat's
// public development key: it is the platform admin of THIS throw-away deployment only.

const PORT = 8547;
const root = path.join(__dirname, "..", "..");

export type ChainFixture = { rpcUrl: string; registry: string; chainId: number };

declare module "vitest" {
  export interface ProvidedContext {
    chain: ChainFixture;
  }
}

let node: ChildProcess | null = null;

async function waitForNode(url: string): Promise<void> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("The local Hardhat node did not start in time");
}

export default async function setup(project: TestProject) {
  const artifact = path.join(root, "artifacts", "contracts", "FarjiRegistry.sol", "FarjiRegistry.json");
  if (!existsSync(artifact)) throw new Error("Contracts are not compiled. Run `npm run compile` (npm run test:chain does it for you).");

  const cli = path.join(root, "node_modules", "hardhat", "internal", "cli", "cli.js");
  node = spawn(process.execPath, [cli, "node", "--port", String(PORT), "--tsconfig", "contracts/tsconfig.json"], { cwd: root, stdio: "ignore" });
  node.on("error", (e) => {
    throw e;
  });
  const rpcUrl = `http://127.0.0.1:${PORT}`;
  await waitForNode(rpcUrl);

  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const admin = new Wallet(HARDHAT_ACCOUNT_0_KEY, provider);
  const { abi, bytecode } = JSON.parse(readFileSync(artifact, "utf8"));
  const factory = new ContractFactory(abi, bytecode, admin);
  const contract = await factory.deploy(0, admin.address, admin.address);
  await contract.waitForDeployment();
  const registry = (await contract.getAddress()).toLowerCase();
  provider.destroy();

  project.provide("chain", { rpcUrl, registry, chainId: 31337 });

  return async () => {
    if (node?.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { stdio: "ignore" });
      else node.kill("SIGTERM");
    }
    node = null;
  };
}
