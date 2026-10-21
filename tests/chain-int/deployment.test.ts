import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChainConfig } from "@/server/chain/config";
import { ChainMisconfiguredError, ensureChainReady, resetChainReadiness } from "@/server/chain/ready";
import { env } from "./harness";

// The deployment safeguards against a REAL node running the REAL FarjiRegistry: the endpoint check that production relies on
// (right network, contract present) and the read-only `chain:check` script an operator runs after deploying to Sepolia.

beforeEach(() => resetChainReadiness());

const cfg = (over: Partial<ChainConfig> = {}): ChainConfig => ({ ...env().cfg, ...over });

describe("endpoint readiness on a real node", () => {
  it("accepts the real node and the real registry", async () => {
    const e = env();
    await expect(ensureChainReady({ cfg: e.cfg, rpc: e.rpc })).resolves.toBeUndefined();
  });

  it("rejects the wrong network: the node says 31337 but the configuration says Sepolia", async () => {
    const e = env();
    await expect(ensureChainReady({ cfg: cfg({ chainId: 11155111n }), rpc: e.rpc })).rejects.toBeInstanceOf(ChainMisconfiguredError);
  });

  it("rejects the wrong contract: an address that holds no registry code", async () => {
    const e = env();
    await expect(ensureChainReady({ cfg: cfg({ registry: e.adminWallet.address.toLowerCase() }), rpc: e.rpc })).rejects.toThrow(/registry contract was not found/);
    await expect(ensureChainReady({ cfg: cfg({ registry: "0x" + "00".repeat(19) + "01" }), rpc: e.rpc })).rejects.toBeInstanceOf(ChainMisconfiguredError);
  });
});

describe("npm run chain:check (read-only deployment verification)", () => {
  const script = join(process.cwd(), "scripts", "check-deployment.cjs");
  const run = (over: Record<string, string>) => {
    const e = env();
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        FARJI_RPC_URL: e.cfg.rpcUrl,
        FARJI_CHAIN_ID: e.cfg.chainId.toString(),
        FARJI_REGISTRY_ADDRESS: e.cfg.registry,
        FARJI_FINALITY: "depth:2",
        FARJI_ADMIN_WALLET: e.adminWallet.address,
        ...over,
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it("passes for the real deployment and shows what it checked", () => {
    const r = run({});
    expect(r.out).toContain("ok   the node reports the configured chain id");
    expect(r.out).toContain("ok   the deployed code is this repository's FarjiRegistry");
    expect(r.out).toContain("ok   FARJI_ADMIN_WALLET holds PLATFORM_ADMIN_ROLE");
    expect(r.out).not.toContain("FAIL");
    expect(r.code).toBe(0);
  });

  it("fails for a wrong chain id, a wrong contract, a wallet that is not the platform admin and a missing RPC", () => {
    const e = env();
    expect(run({ FARJI_CHAIN_ID: "1337" })).toMatchObject({ code: 1 });
    expect(run({ FARJI_CHAIN_ID: "1337" }).out).toContain("FAIL the node reports the configured chain id");
    const wrongContract = run({ FARJI_REGISTRY_ADDRESS: e.adminWallet.address });
    expect(wrongContract.code).toBe(1);
    expect(wrongContract.out).toContain("FAIL a contract exists at the registry address");
    const notAdmin = run({ FARJI_ADMIN_WALLET: "0x000000000000000000000000000000000000dEaD" });
    expect(notAdmin.code).toBe(1);
    expect(notAdmin.out).toContain("FAIL FARJI_ADMIN_WALLET holds PLATFORM_ADMIN_ROLE");
    expect(run({ FARJI_RPC_URL: "" }).code).toBe(1);
  });

  it("refuses mainnet and depth-based finality for Sepolia before it even contacts a node", () => {
    const mainnet = run({ FARJI_CHAIN_ID: "1" });
    expect(mainnet.code).toBe(1);
    expect(mainnet.out).toContain("FAIL FARJI_CHAIN_ID is a supported network");
    const depth = run({ FARJI_CHAIN_ID: "11155111", FARJI_FINALITY: "depth:0" });
    expect(depth.code).toBe(1);
    expect(depth.out).toContain("FAIL finality policy fits the network");
  });
});
