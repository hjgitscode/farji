import { beforeEach, describe, expect, it } from "vitest";
import { isInfrastructureError, toFail } from "@/server/chain/results";
import { ChainMisconfiguredError, ensureChainReady, resetChainReadiness } from "@/server/chain/ready";
import type { ChainConfig } from "@/server/chain/config";
import { walletMessage, WalletError } from "@/components/wallet/wallet";
import { DomainError } from "@/server/candidate/errors";
import { FakeRpc, REGISTRY } from "../fixtures/fake-rpc";

// The configured RPC must really be the configured network and hold a registry; failures are described without internals.

const cfg = (over: Partial<ChainConfig> = {}): ChainConfig => ({ rpcUrl: "https://rpc.example/a", chainId: 11155111n, registry: REGISTRY, finality: { mode: "finalized" }, ...over });
const sepoliaRpc = () => Object.assign(new FakeRpc(), { chainId: 11155111n });

beforeEach(() => resetChainReadiness());

describe("endpoint readiness (wrong chain, wrong contract)", () => {
  it("accepts a node on the configured chain with code at the registry", async () => {
    await expect(ensureChainReady({ cfg: cfg(), rpc: sepoliaRpc() })).resolves.toBeUndefined();
  });

  it("rejects a node that reports a different chain, even though the provider was told the configured one", async () => {
    const rpc = Object.assign(new FakeRpc(), { chainId: 1n });
    await expect(ensureChainReady({ cfg: cfg(), rpc })).rejects.toBeInstanceOf(ChainMisconfiguredError);
    await expect(ensureChainReady({ cfg: cfg(), rpc })).rejects.toThrow(/wrong network/);
  });

  it("rejects an address with no contract (wrong registry)", async () => {
    const rpc = Object.assign(sepoliaRpc(), { code: "0x" });
    await expect(ensureChainReady({ cfg: cfg(), rpc })).rejects.toThrow(/registry contract was not found/);
  });

  it("reports an unreachable node as temporary, without the node's message", async () => {
    const rpc = sepoliaRpc();
    rpc.getChainId = async () => {
      throw new Error("connect ECONNREFUSED 10.1.2.3:8545 secret-key-in-url");
    };
    const err = await ensureChainReady({ cfg: cfg(), rpc }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.message).toMatch(/temporarily unavailable/);
    expect(err.message).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|secret/);
  });

  it("caches success briefly but never caches a failure, and re-checks after the window", async () => {
    const rpc = sepoliaRpc();
    let calls = 0;
    const original = rpc.getChainId.bind(rpc);
    rpc.getChainId = async () => (calls++, original());
    await ensureChainReady({ cfg: cfg(), rpc }, 0);
    await ensureChainReady({ cfg: cfg(), rpc }, 1000);
    expect(calls).toBe(1);
    await ensureChainReady({ cfg: cfg(), rpc }, 10 * 60_000);
    expect(calls).toBe(2);

    resetChainReadiness();
    const bad = Object.assign(sepoliaRpc(), { chainId: 5n });
    await expect(ensureChainReady({ cfg: cfg(), rpc: bad }, 0)).rejects.toThrow();
    bad.chainId = 11155111n; // fixed: the very next call checks again
    await expect(ensureChainReady({ cfg: cfg(), rpc: bad }, 1)).resolves.toBeUndefined();
  });

  it("different registries are checked independently", async () => {
    const rpc = sepoliaRpc();
    await ensureChainReady({ cfg: cfg(), rpc });
    rpc.code = "0x";
    await expect(ensureChainReady({ cfg: cfg({ registry: "0x" + "12".repeat(20) }), rpc })).rejects.toThrow();
  });
});

describe("user-facing failures never leak internals", () => {
  it("recognises infrastructure outages", () => {
    for (const m of ["connect ECONNREFUSED 1.2.3.4:5432", "fetch failed", "Can't reach database server at db.example:5432", "SERVER_ERROR (code=-32000)", "request timeout (TIMEOUT)", "P1017"]) expect(isInfrastructureError(m), m).toBe(true);
    expect(isInfrastructureError("The wallet is not authorised")).toBe(false);
  });

  it("maps outages, misconfiguration and unknown errors to short safe sentences", () => {
    const outage = toFail(new Error("Can't reach database server at aws-0-ap-south-1.pooler.supabase.com:6543 password=hunter2"));
    expect(outage.error).toMatch(/could not reach a required service/);
    expect(JSON.stringify(outage)).not.toMatch(/supabase|hunter2|6543/);
    expect(toFail(new Error("FARJI_RPC_URL is not set")).error).toMatch(/not configured/);
    const unknown = toFail(new Error("boom at /srv/app/server/chain/x.ts:12\n  at stack frames"));
    expect(unknown.error).toBe("Something went wrong. Please try again.");
    expect(toFail(new DomainError("FORBIDDEN", "Only an administrator can do this.")).error).toBe("Only an administrator can do this.");
  });
});

describe("wallet messages", () => {
  it("explain the common wallet failures in plain words", () => {
    expect(walletMessage(new WalletError("No browser wallet was found. Install a wallet such as MetaMask, then try again."))).toMatch(/MetaMask/);
    expect(walletMessage({ code: 4001, message: "User rejected the request." })).toMatch(/declined/);
    expect(walletMessage({ code: -32002 })).toMatch(/already has a request waiting/);
    expect(walletMessage({ code: 4900 })).toMatch(/disconnected/);
    expect(walletMessage({ message: "insufficient funds for gas * price + value" })).toMatch(/enough test ETH/);
    expect(walletMessage({ message: "execution reverted: NotOpenIssuerOf(...)" })).toMatch(/network rejected/);
  });

  it("never echoes an unknown raw message", () => {
    expect(walletMessage({ message: "internal error at 0xdeadbeef /Users/me/secret.js" })).toBe("The wallet request did not complete. Please try again.");
    expect(walletMessage(undefined)).toBe("The wallet request did not complete. Please try again.");
  });
});
