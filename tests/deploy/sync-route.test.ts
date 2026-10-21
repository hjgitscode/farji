import { beforeEach, describe, expect, it, vi } from "vitest";

// The scheduled sync endpoint: who may call it, what it does, and that repeating it is safe. The chain and database are replaced
// by stubs here; the real sync state machine (idempotent, finalized-only mirror) is covered by tests/db/chain-sync.test.ts and
// the real-node suite (tests/chain-int).

const syncPending = vi.fn();
const ensureChainReady = vi.fn();

vi.mock("@/lib/database/client", () => ({ getDb: () => ({}) }));
vi.mock("@/server/chain/context", () => ({ getChain: () => ({ cfg: {}, rpc: {}, reader: {} }) }));
vi.mock("@/server/chain/sync", () => ({ syncPending: (...a: unknown[]) => syncPending(...a) }));
vi.mock("@/server/chain/ready", async (orig) => ({ ...(await orig<typeof import("@/server/chain/ready")>()), ensureChainReady: (...a: unknown[]) => ensureChainReady(...a) }));

const TOKEN = "k3Jd9sLq2VbN7xPzR4tYw8mAcE6uHg1Fa";
let n = 0;
/** A request from a unique caller, so the per-instance limiter never couples tests together. */
const req = (headers: Record<string, string | undefined> = {}, method = "POST") => {
  n += 1;
  return new Request("http://localhost/api/chain/sync", { method, headers: { "x-real-ip": `198.51.100.${n}`, ...(Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<string, string>) } });
};

async function load() {
  vi.resetModules();
  return import("@/app/api/chain/sync/route");
}

beforeEach(() => {
  vi.stubEnv("FARJI_SYNC_TOKEN", TOKEN);
  vi.stubEnv("VERCEL", "1");
  syncPending.mockReset().mockResolvedValue([]);
  ensureChainReady.mockReset().mockResolvedValue(undefined);
});

describe("authorisation", () => {
  it("refuses a request with no token, a wrong token, a truncated token and a different scheme", async () => {
    const { POST } = await load();
    for (const h of [{}, { authorization: "Bearer wrong" }, { authorization: `Bearer ${TOKEN.slice(0, -1)}` }, { authorization: `Basic ${TOKEN}` }, { authorization: `Bearer ${TOKEN}x` }]) {
      const res = await POST(req(h));
      expect(res.status).toBe(401);
    }
    expect(syncPending).not.toHaveBeenCalled();
    expect(ensureChainReady).not.toHaveBeenCalled();
  });

  it("refuses everything when no token (or a short one) is configured", async () => {
    const { POST } = await load();
    for (const t of ["", "short"]) {
      vi.stubEnv("FARJI_SYNC_TOKEN", t);
      expect((await POST(req({ authorization: `Bearer ${t}` }))).status).toBe(401);
    }
    expect(syncPending).not.toHaveBeenCalled();
  });

  it("does not leak which part was wrong", async () => {
    const { POST } = await load();
    const body = await (await POST(req({ authorization: "Bearer nope" }))).json();
    expect(body).toEqual({ error: "unauthorised" });
  });

  it("slows repeated wrong guesses from one caller", async () => {
    const { POST } = await load();
    const headers = { "x-real-ip": "203.0.113.200", authorization: "Bearer guess" };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await POST(new Request("http://localhost/api/chain/sync", { method: "POST", headers }))).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // the right token from another caller is unaffected
    expect((await POST(req({ authorization: `Bearer ${TOKEN}` }))).status).toBe(200);
  });
});

describe("authorised sync", () => {
  it("syncs pending transactions and reports only counts", async () => {
    syncPending.mockResolvedValue([
      { id: "1", status: "FINALIZED", changed: true },
      { id: "2", status: "CONFIRMED", changed: false },
      { id: "3", status: "CONFIRMED", changed: false, error: "authorisation not mirrored yet" },
    ]);
    const { POST } = await load();
    const res = await POST(req({ authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 3, changed: 1, errors: 1 });
    expect(ensureChainReady).toHaveBeenCalledTimes(1); // the endpoint is checked before any chain read
  });

  it("Vercel Cron's GET works with the same token, and is idempotent when repeated", async () => {
    const { GET, POST } = await load();
    syncPending.mockResolvedValueOnce([{ id: "1", status: "FINALIZED", changed: true }]).mockResolvedValueOnce([]);
    const first = await (await GET(req({ authorization: `Bearer ${TOKEN}` }, "GET"))).json();
    const second = await (await POST(req({ authorization: `Bearer ${TOKEN}` }))).json();
    expect(first).toEqual({ checked: 1, changed: 1, errors: 0 });
    expect(second).toEqual({ checked: 0, changed: 0, errors: 0 }); // nothing left to move
    expect((await GET(req({}, "GET"))).status).toBe(401); // GET is not a way around the token
  });

  it("reports a misconfigured or unreachable chain as 503 without any detail", async () => {
    const { ChainMisconfiguredError } = await import("@/server/chain/ready");
    const { POST } = await load();
    ensureChainReady.mockRejectedValueOnce(new ChainMisconfiguredError("wrong network, secret detail"));
    const wrong = await POST(req({ authorization: `Bearer ${TOKEN}` }));
    expect(wrong.status).toBe(503);
    expect(JSON.stringify(await wrong.json())).not.toContain("secret detail");
    syncPending.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:8545"));
    const down = await POST(req({ authorization: `Bearer ${TOKEN}` }));
    expect(down.status).toBe(503);
    expect(JSON.stringify(await down.json())).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
  });
});
