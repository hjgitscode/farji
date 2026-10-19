import { afterAll, describe, expect, it } from "vitest";
import { acceptCredentialSignature, prepareCredentialSigning } from "@/server/issuance/signing";
import { acceptStatusChange, prepareEndRelationship } from "@/server/issuance/status-change";
import { TEST_CONFIG, freshWallet } from "../fixtures/test-wallets";
import { db, inRollback, mkOrg } from "./helpers";
import { addKey, approvedCredential, CONTINUING, issuerOf, signCredential, signOpts, SIGN_NOW } from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

// D46 (Phase 9): a mirror row is never authority. Signing needs a FINALIZED authorisation
// transaction AND the chain's own answer that the wallet was authorised at `issuedAt`.
describe("D46: issuer authority comes from finalised chain evidence", () => {
  async function attempt(keyOpts: Parameters<typeof addKey>[3], chain?: { isIssuerAuthorisedAt: (o: string, w: string, t: bigint) => Promise<boolean> }) {
    return inRollback(async (tx) => {
      const f = await approvedCredential(tx);
      const wallet = freshWallet();
      await addKey(tx, f.orgId, wallet, keyOpts);
      const org = await tx.organisation.findUniqueOrThrow({ where: { id: f.orgId } });
      const err = await caught(signCredential(tx, f, wallet, { enqueue: false, ...(chain ? { chain } : {}) }));
      return { err, org, wallet, c: await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } }), atts: await tx.attestation.count({ where: { credentialRowId: f.credentialRowId } }) };
    });
  }

  it("a hand-made IssuerKey row (no authorisation transaction) cannot sign", async () => {
    const r = await attempt({ withoutAuthoriseTx: true });
    expect(r.err).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/finalised on-chain/) });
    expect(r.c.pipelineStatus).toBe("AWAITING_SIGNATURE");
    expect(r.atts).toBe(0);
  });

  it("a key whose authorisation transaction is only PENDING or CONFIRMED cannot sign", async () => {
    for (const authoriseTxStatus of ["PENDING", "CONFIRMED"] as const) {
      const r = await attempt({ authoriseTxStatus });
      expect(r.err, authoriseTxStatus).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/finalised on-chain/) });
      expect(r.atts).toBe(0);
    }
  });

  it("a key with a FINALIZED authorisation still needs the chain to confirm it at issuedAt", async () => {
    const denied = await attempt({}, { isIssuerAuthorisedAt: async () => false });
    expect(denied.err).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/chain does not show/) });
    expect(denied.atts).toBe(0);
  });

  it("the chain is asked about the organisation's on-chain id, the recovered wallet and the signed issuedAt", async () => {
    const calls: [string, string, bigint][] = [];
    const r = await attempt({}, { isIssuerAuthorisedAt: async (o, w, t) => (calls.push([o, w, t]), true) });
    expect(r.err).toBeNull();
    expect(calls).toEqual([[r.org.orgId, r.wallet.address.toLowerCase(), BigInt(SIGN_NOW.getTime() / 1000)]]);
    expect(r.atts).toBe(1);
  });

  it("the same applies to ending a CONTINUING relationship (status changes)", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const good = freshWallet();
      await addKey(tx, org.id, good);
      const f = await approvedCredential(tx, CONTINUING, { orgId: org.id, issuer });
      await signCredential(tx, f, good, { enqueue: true });

      const handMade = freshWallet();
      await addKey(tx, org.id, handMade, { withoutAuthoriseTx: true });
      const endAt = new Date("2026-10-19T00:00:00Z");
      const now = new Date("2026-10-20T10:00:00Z");
      const sign = async (wallet: typeof good, chain: { isIssuerAuthorisedAt: () => Promise<boolean> }) => {
        const prep = await prepareEndRelationship(tx, issuer, f.credentialRowId, { effectiveAt: endAt }, { config: TEST_CONFIG, now });
        const signature = await wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
        return caught(acceptStatusChange(tx, issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, effectiveAt: prep.effectiveAt, nonce: prep.nonce }, { config: TEST_CONFIG, now, chain }));
      };
      return {
        handMade: await sign(handMade, { isIssuerAuthorisedAt: async () => true }),
        chainDenies: await sign(good, { isIssuerAuthorisedAt: async () => false }),
        ok: await sign(good, { isIssuerAuthorisedAt: async () => true }),
        status: (await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } })).status,
      };
    });
    expect(r.handMade).toMatchObject({ code: "FORBIDDEN" });
    expect(r.chainDenies).toMatchObject({ code: "FORBIDDEN" });
    expect(r.ok).toBeNull();
    expect(r.status).toBe("ENDED");
  });

  it("with no injected chain and no configuration, accepting a signature fails closed (never silently allows)", async () => {
    if (process.env.FARJI_RPC_URL) return; // a configured environment
    const err = await inRollback(async (tx) => {
      const f = await approvedCredential(tx);
      const wallet = freshWallet();
      await addKey(tx, f.orgId, wallet);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const signature = await wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      return caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, signOpts({ chain: undefined })));
    });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/FARJI_(CHAIN_ID|REGISTRY_ADDRESS|RPC_URL)/);
  });
});
