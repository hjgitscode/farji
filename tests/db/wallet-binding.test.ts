import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { acceptWalletBinding, prepareWalletBinding } from "@/server/issuance/wallet-binding";
import { TEST_CONFIG, freshWallet, type TestWallet } from "../fixtures/test-wallets";
import { db, inRollback, mkMember, mkOrg, type Tx } from "./helpers";
import { addKey, issuerOf, SIGN_NOW } from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);
const opts = { config: TEST_CONFIG, now: SIGN_NOW };

async function bind(tx: Tx, actor: Actor, claimedWallet: string, signer: TestWallet, over: { now?: Date } = {}) {
  const prep = await prepareWalletBinding(tx, actor, claimedWallet, opts);
  const signature = await signer.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  return acceptWalletBinding(tx, actor, { wallet: claimedWallet, signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, { ...opts, ...over });
}

describe("wallet proof of possession (operatorMemberId binding)", () => {
  it("binds the issuer member as operator only after the wallet signs the binding message", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const wallet = freshWallet();
      const key = await addKey(tx, org.id, wallet);
      const result = await bind(tx, issuer, wallet.address, wallet);
      return { key, result, after: await tx.issuerKey.findUniqueOrThrow({ where: { id: key.id } }), issuer, audits: await tx.auditEvent.count({ where: { action: "ISSUER_WALLET_BOUND", targetId: key.id } }) };
    });
    expect(r.result).toMatchObject({ issuerKeyId: r.key.id, operatorMemberId: r.issuer.memberId, alreadyBound: false });
    expect(r.after.operatorMemberId).toBe(r.issuer.memberId);
    expect(r.audits).toBe(1);
  });

  it("is idempotent for the same member", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const wallet = freshWallet();
      await addKey(tx, org.id, wallet);
      await bind(tx, issuer, wallet.address, wallet);
      return bind(tx, issuer, wallet.address, wallet);
    });
    expect(r.alreadyBound).toBe(true);
  });

  it("a browser-claimed address without the wallet's signature is refused (someone else's signature)", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const real = freshWallet();
      const impostor = freshWallet();
      const key = await addKey(tx, org.id, real);
      const err = await caught(bind(tx, issuer, real.address, impostor)); // claims `real`, signed by `impostor`
      return { err, after: await tx.issuerKey.findUniqueOrThrow({ where: { id: key.id } }) };
    });
    expect(r.err).toMatchObject({ code: "FORBIDDEN" });
    expect(r.after.operatorMemberId).toBeNull();
  });

  it("a wallet of ANOTHER organisation, an unknown wallet and a hand-made (unfinalised) key cannot be bound", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const other = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const foreign = freshWallet();
      await addKey(tx, other.id, foreign);
      const unknown = freshWallet();
      const handMade = freshWallet();
      await addKey(tx, org.id, handMade, { withoutAuthoriseTx: true });
      return {
        foreign: await caught(bind(tx, issuer, foreign.address, foreign)),
        unknown: await caught(bind(tx, issuer, unknown.address, unknown)),
        handMade: await caught(bind(tx, issuer, handMade.address, handMade)),
      };
    });
    for (const e of Object.values(r)) expect(e).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a wallet already bound to another member cannot be taken over", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const first = await issuerOf(tx, org.id);
      const { user, member } = await mkMember(tx, org.id);
      const second: Actor = { ...first, userId: user.id, memberId: member.id };
      const wallet = freshWallet();
      const key = await addKey(tx, org.id, wallet);
      await bind(tx, first, wallet.address, wallet);
      const err = await caught(bind(tx, second, wallet.address, wallet));
      return { err, after: await tx.issuerKey.findUniqueOrThrow({ where: { id: key.id } }), first };
    });
    expect(r.err).toMatchObject({ code: "CONFLICT" });
    expect(r.after.operatorMemberId).toBe(r.first.memberId);
  });

  it("a retired or compromised wallet cannot be bound", async () => {
    const err = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const wallet = freshWallet();
      await addKey(tx, org.id, wallet, { validUntil: new Date("2026-06-01T00:00:00Z") });
      return caught(bind(tx, issuer, wallet.address, wallet));
    });
    expect(err).toMatchObject({ code: "CONFLICT" });
  });

  it("the signed message names the member: another member cannot reuse a signature", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const first = await issuerOf(tx, org.id);
      const { user, member } = await mkMember(tx, org.id);
      const second: Actor = { ...first, userId: user.id, memberId: member.id };
      const wallet = freshWallet();
      await addKey(tx, org.id, wallet);
      const prep = await prepareWalletBinding(tx, first, wallet.address, opts);
      const signature = await wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      // The second member submits the first member's signature.
      return caught(acceptWalletBinding(tx, second, { wallet: wallet.address, signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, opts));
    });
    expect(r).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a stale signature is refused; non-issuers and removed members are refused", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const wallet = freshWallet();
      await addKey(tx, org.id, wallet);
      const stale = await caught(bind(tx, issuer, wallet.address, wallet, { now: new Date(SIGN_NOW.getTime() + 20 * 60_000) }));
      const candidate = await caught(prepareWalletBinding(tx, { ...issuer, role: "CANDIDATE" }, wallet.address, opts));
      await tx.organisationMember.update({ where: { id: issuer.memberId! }, data: { status: "REMOVED", removedAt: new Date() } });
      const removed = await caught(bind(tx, issuer, wallet.address, wallet));
      return { stale, candidate, removed };
    });
    expect(r.stale).toMatchObject({ code: "VALIDATION" });
    expect(r.candidate).toMatchObject({ code: "FORBIDDEN" });
    expect(r.removed).toMatchObject({ code: "FORBIDDEN" });
  });

  it("invalid wallet strings are rejected before anything is read", async () => {
    const err = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      return caught(prepareWalletBinding(tx, issuer, "0x1234", opts));
    });
    expect(err).toMatchObject({ code: "VALIDATION" });
  });
});
