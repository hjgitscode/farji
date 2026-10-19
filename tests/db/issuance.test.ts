import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { areDistinctSalts, contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import { ZERO_HASH } from "@/lib/crypto/constants";
import { dateToUnixSeconds, isoDateToUnixSeconds, uuidToBytes16 } from "@/lib/crypto/encoding";
import { recoverSigner, typedDataHash } from "@/lib/crypto/eip712";
import { wasKeyValidForAttestation } from "@/lib/crypto/keys";
import { submitVerificationRequest, updateClaim } from "@/server/candidate/claims";
import { acceptCredentialSignature, prepareCredentialSigning } from "@/server/issuance/signing";
import { approveVerificationRequest } from "@/server/issuer/review";
import { TEST_CONFIG, freshWallet } from "../fixtures/test-wallets";
import { db, inRollback, mkMember, mkOrg, type Tx } from "./helpers";
import {
  addKey,
  approvedCredential,
  APPROVE_NOW,
  CLAIM_NOW,
  EXPIRING,
  issuerOf,
  PERMANENT,
  signCredential,
  signOpts,
  SIGN_NOW,
} from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const credentialOf = (tx: Tx, id: string) => tx.credential.findUniqueOrThrow({ where: { id } });
const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

/** Fixture + an open issuer key for a fresh test wallet, ready to sign. */
async function ready(tx: Tx, draft: Record<string, unknown> = PERMANENT) {
  const f = await approvedCredential(tx, draft);
  const wallet = freshWallet();
  const key = await addKey(tx, f.orgId, wallet);
  return { ...f, wallet, key };
}

describe("prepareCredentialSigning", () => {
  it("writes three distinct salts and the derived identifiers once, and stays AWAITING_SIGNATURE", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      return { f, prep, c: await credentialOf(tx, f.credentialRowId), org: await tx.organisation.findUniqueOrThrow({ where: { id: f.orgId } }), cand: f.cand };
    });
    const c = r.c;
    expect(c.pipelineStatus).toBe("AWAITING_SIGNATURE");
    for (const v of [c.credentialSalt, c.contentSalt, c.subjectSalt, c.credentialId, c.subjectCommitment, c.contentDigest]) expect(v).toMatch(/^0x[0-9a-f]{64}$/);
    expect(areDistinctSalts(c.credentialSalt!, c.contentSalt!, c.subjectSalt!)).toBe(true);
    expect(c.credentialId).toBe(credentialIdOf(r.org.orgId, c.credentialSalt!));
    expect(c.subjectCommitment).toBe(subjectCommitmentOf(uuidToBytes16(r.cand.userId), c.subjectSalt!));
    expect(r.prep.credentialId).toBe(c.credentialId);
    expect(r.prep.typedData.message.content.title).toBe("Software Engineer"); // what the issuer's wallet shows
    expect(c.issuedAt).toBeNull();
    expect(c.supersedesCredentialId).toBeNull();
  });

  it("validFrom is the claim's effective start date, NOT the signing time; issuedAt stays unset until signing", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      return { prep, c: await credentialOf(tx, f.credentialRowId) };
    });
    expect(r.c.validFrom?.toISOString()).toBe("2022-01-10T00:00:00.000Z");
    expect(r.prep.typedData.message.validFrom).toBe(isoDateToUnixSeconds("2022-01-10"));
    expect(r.prep.typedData.message.issuedAt).toBe(dateToUnixSeconds(SIGN_NOW));
    expect(r.prep.typedData.message.validFrom).not.toBe(r.prep.typedData.message.issuedAt);
    expect(r.c.issuedAt).toBeNull();
  });

  it("is idempotent: the stored salts and identifiers never change, only issuedAt and nonce are fresh", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const p1 = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const c1 = await credentialOf(tx, f.credentialRowId);
      const p2 = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: new Date(SIGN_NOW.getTime() + 5000) });
      const c2 = await credentialOf(tx, f.credentialRowId);
      return { p1, p2, c1, c2 };
    });
    expect(r.c2).toEqual(r.c1); // identical row, nothing rewritten
    expect(r.p2.credentialId).toBe(r.p1.credentialId);
    expect(r.p2.nonce).not.toBe(r.p1.nonce);
    expect(r.p2.typedData.message.content.contentSalt).toBe(r.p1.typedData.message.content.contentSalt);
    expect(r.p2.typedDataHash).not.toBe(r.p1.typedDataHash);
  });

  it("an EXPIRING credential's expiry is carried as validUntil in the message", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx, EXPIRING);
      return prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
    });
    expect(r.typedData.message.validUntil).toBe(isoDateToUnixSeconds("2027-03-31"));
    expect(r.typedData.message.lifecycleType).toBe(2);
  });

  it("is refused for a credential of another organisation (NOT_FOUND) and for non-current versions", async () => {
    const r = await inRollback(async (tx) => {
      const a = await ready(tx);
      const bOrg = await mkOrg(tx, "ACTIVE");
      const bIssuer = await issuerOf(tx, bOrg.id);
      const cross = await caught(prepareCredentialSigning(tx, bIssuer, a.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW }));

      await updateClaim(tx, a.cand, a.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const stale = await caught(prepareCredentialSigning(tx, a.issuer, a.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW }));
      return { cross, stale, c: await credentialOf(tx, a.credentialRowId) };
    });
    expect(r.cross).toMatchObject({ code: "NOT_FOUND" });
    expect(r.stale).toMatchObject({ code: "CONFLICT" });
    expect(r.c.credentialSalt).toBeNull(); // nothing was prepared
  });

  it("refuses an issuer to sign for their own claim", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const claim = await tx.claim.create({ data: { candidateId: issuer.userId, category: "EXPERIENCE" } });
      const version = await tx.claimVersion.create({
        data: { claimId: claim.id, versionNumber: 1, content: { title: "Mine", organisationName: "Acme", startDate: "2020-01-01", endDate: "2021-01-01" }, proposedLifecycleType: "PERMANENT" },
      });
      const credential = await tx.credential.create({ data: { organisationId: org.id, claimVersionId: version.id, lifecycleType: "PERMANENT" } });
      const err = await caught(prepareCredentialSigning(tx, issuer, credential.id, { config: TEST_CONFIG, now: SIGN_NOW }));
      return { err, c: await credentialOf(tx, credential.id) };
    });
    expect(r.err).toMatchObject({ code: "FORBIDDEN" });
    expect(r.c.credentialSalt).toBeNull();
  });

  it("is disabled until the chain id and registry address are configured", async () => {
    if (process.env.FARJI_CHAIN_ID || process.env.FARJI_REGISTRY_ADDRESS) return; // configured environment
    const err = await inRollback(async (tx) => {
      const f = await ready(tx);
      return caught(prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { now: SIGN_NOW }));
    });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/FARJI_CHAIN_ID/);
  });
});

describe("acceptCredentialSignature", () => {
  it("verifies the signature, moves to SIGNED and stores exactly one Attestation", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const { prep, signature, accepted } = await signCredential(tx, f, f.wallet, { enqueue: false });
      return {
        f,
        prep,
        signature,
        accepted,
        c: await credentialOf(tx, f.credentialRowId),
        atts: await tx.attestation.findMany({ where: { credentialRowId: f.credentialRowId } }),
      };
    });
    expect(r.accepted).toMatchObject({ pipelineStatus: "SIGNED", idempotent: false, queued: false });
    expect(r.c.pipelineStatus).toBe("SIGNED");
    expect(r.c.issuedAt?.toISOString()).toBe(SIGN_NOW.toISOString()); // the signature time...
    expect(r.c.validFrom?.toISOString()).toBe("2022-01-10T00:00:00.000Z"); // ...is not the claim start
    expect(r.c.validFrom?.getTime()).not.toBe(r.c.issuedAt?.getTime());
    expect(r.atts).toHaveLength(1);
    expect(r.atts[0]).toMatchObject({
      kind: "CREDENTIAL",
      organisationId: r.f.orgId,
      signerKeyId: r.f.key.id,
      typedDataHash: r.prep.typedDataHash,
      signature: r.signature.toLowerCase(),
      nonce: r.prep.nonce,
      chainId: 31337,
      verifyingContract: TEST_CONFIG.verifyingContract,
      statusSeq: null,
      newStatus: null,
    });
    expect(r.atts[0].issuedAt.toISOString()).toBe(SIGN_NOW.toISOString());
    // The stored signature recovers the registered wallet from the rebuilt typed data.
    expect(recoverSigner(r.prep.typedData, r.atts[0].signature)).toBe(r.f.wallet.address.toLowerCase());
    expect(typedDataHash(r.prep.typedData)).toBe(r.atts[0].typedDataHash);
  });

  it("the stored Attestation holds no content and no salts", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      await signCredential(tx, f, f.wallet, { enqueue: false });
      return { c: await credentialOf(tx, f.credentialRowId), att: await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } }) };
    });
    const text = JSON.stringify(r.att);
    for (const secret of [r.c.credentialSalt, r.c.contentSalt, r.c.subjectSalt, "Software Engineer", "Acme"]) expect(text).not.toContain(secret as string);
  });

  it("a duplicate accept of the same signed message is idempotent (still one Attestation)", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const first = await signCredential(tx, f, f.wallet, { enqueue: false });
      const again = await acceptCredentialSignature(
        tx,
        f.issuer,
        f.credentialRowId,
        { signature: first.signature, issuedAt: first.prep.issuedAt, nonce: first.prep.nonce },
        signOpts({ enqueue: false }),
      );
      return { first, again, count: await tx.attestation.count({ where: { credentialRowId: f.credentialRowId } }) };
    });
    expect(r.again).toMatchObject({ idempotent: true, attestationId: r.first.accepted.attestationId });
    expect(r.count).toBe(1);
  });

  it("a different signed message for an already signed credential is a CONFLICT, as is preparing again", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const first = await signCredential(tx, f, f.wallet, { enqueue: false });
      const second = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW }).catch((e) => e);
      // Forge a second valid-looking signature with a fresh nonce.
      const td = first.prep.typedData;
      const forged = await f.wallet.signTypedData(td.domain, td.types, { ...td.message, nonce: "0x" + "ab".repeat(32) });
      const replay = await caught(
        acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature: forged, issuedAt: first.prep.issuedAt, nonce: "0x" + "ab".repeat(32) }, signOpts({ enqueue: false })),
      );
      return { second, replay, count: await tx.attestation.count({ where: { credentialRowId: f.credentialRowId } }) };
    });
    expect(r.second).toMatchObject({ code: "CONFLICT" });
    expect(r.replay).toMatchObject({ code: "CONFLICT" });
    expect(r.count).toBe(1);
  });

  it("refuses accepting without preparing", async () => {
    const err = await inRollback(async (tx) => {
      const f = await ready(tx);
      return caught(
        acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature: "0x" + "11".repeat(65), issuedAt: "1760000000", nonce: "0x" + "ab".repeat(32) }, signOpts()),
      );
    });
    expect(err).toBeDefined();
    expect(["CONFLICT", "VALIDATION"]).toContain((err as { code: string }).code);
  });

  it("rejects malformed signature input", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const go = (input: Record<string, unknown>) => caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, input as never, signOpts()));
      const good = await f.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      return {
        noSig: await go({ issuedAt: prep.issuedAt, nonce: prep.nonce }),
        shortSig: await go({ signature: "0x1234", issuedAt: prep.issuedAt, nonce: prep.nonce }),
        badNonce: await go({ signature: good, issuedAt: prep.issuedAt, nonce: "0x12" }),
        badIssuedAt: await go({ signature: good, issuedAt: "yesterday", nonce: prep.nonce }),
      };
    });
    for (const e of Object.values(r)) expect(e).toMatchObject({ code: "VALIDATION" });
  });

  it("wrong organisation: a wallet authorised for ANOTHER organisation is refused", async () => {
    const r = await inRollback(async (tx) => {
      const f = await approvedCredential(tx);
      const otherOrg = await mkOrg(tx, "ACTIVE");
      const wallet = freshWallet();
      await addKey(tx, otherOrg.id, wallet);
      const err = await caught(signCredential(tx, f, wallet, { enqueue: false }));
      return { err, c: await credentialOf(tx, f.credentialRowId), atts: await tx.attestation.count({ where: { credentialRowId: f.credentialRowId } }) };
    });
    expect(r.err).toMatchObject({ code: "FORBIDDEN" });
    expect(r.c.pipelineStatus).toBe("AWAITING_SIGNATURE");
    expect(r.atts).toBe(0);
  });

  it("an unknown wallet (no IssuerKey) is refused", async () => {
    const err = await inRollback(async (tx) => {
      const f = await approvedCredential(tx);
      return caught(signCredential(tx, f, freshWallet(), { enqueue: false }));
    });
    expect(err).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a tampered message (another nonce or issuedAt than the one signed) recovers a different wallet and is refused", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const signature = await f.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      const wrongNonce = await caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: "0x" + "ee".repeat(32) }, signOpts()));
      const wrongIssuedAt = await caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature, issuedAt: String(BigInt(prep.issuedAt) + 1n), nonce: prep.nonce }, signOpts()));
      return { wrongNonce, wrongIssuedAt, c: await credentialOf(tx, f.credentialRowId) };
    });
    expect(r.wrongNonce).toMatchObject({ code: "FORBIDDEN" });
    expect(r.wrongIssuedAt).toMatchObject({ code: "FORBIDDEN" });
    expect(r.c.pipelineStatus).toBe("AWAITING_SIGNATURE");
  });

  it("a signature made for another chain or contract is refused", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const otherChain = { ...prep.typedData.domain, chainId: 1n };
      const signature = await f.wallet.signTypedData(otherChain, prep.typedData.types, prep.typedData.message);
      return caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, signOpts()));
    });
    expect(r).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a signature over a different credential's data does not validate (replay across credentials)", async () => {
    const r = await inRollback(async (tx) => {
      const a = await ready(tx);
      // A second approved credential in the same organisation, signed by the same wallet.
      const b = await approvedCredential(tx, PERMANENT, { orgId: a.orgId, issuer: a.issuer });
      const first = await signCredential(tx, a, a.wallet, { enqueue: false });
      const prepB = await prepareCredentialSigning(tx, b.issuer, b.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      void prepB;
      return caught(
        acceptCredentialSignature(tx, b.issuer, b.credentialRowId, { signature: first.signature, issuedAt: first.prep.issuedAt, nonce: first.prep.nonce }, signOpts({ enqueue: false })),
      );
    });
    expect(r).toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a stale or future issuedAt", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const signature = await f.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      const input = { signature, issuedAt: prep.issuedAt, nonce: prep.nonce };
      const stale = await caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, input, signOpts({ now: new Date(SIGN_NOW.getTime() + 11 * 60 * 1000) })));
      const future = await caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, input, signOpts({ now: new Date(SIGN_NOW.getTime() - 3 * 60 * 1000) })));
      const justInside = await acceptCredentialSignature(tx, f.issuer, f.credentialRowId, input, signOpts({ now: new Date(SIGN_NOW.getTime() + 9 * 60 * 1000), enqueue: false }));
      return { stale, future, justInside };
    });
    expect(r.stale).toMatchObject({ code: "VALIDATION" });
    expect(r.future).toMatchObject({ code: "VALIDATION" });
    expect(r.justInside.pipelineStatus).toBe("SIGNED");
  });

  it("non-issuer and cross-organisation issuers cannot accept", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const signature = await f.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      const input = { signature, issuedAt: prep.issuedAt, nonce: prep.nonce };
      const otherOrg = await mkOrg(tx, "ACTIVE");
      const otherIssuer = await issuerOf(tx, otherOrg.id);
      const asCandidate: Actor = { ...f.issuer, role: "CANDIDATE" };
      const asAdmin: Actor = { ...f.issuer, role: "ADMIN" };
      return {
        candidate: await caught(acceptCredentialSignature(tx, asCandidate, f.credentialRowId, input, signOpts())),
        admin: await caught(acceptCredentialSignature(tx, asAdmin, f.credentialRowId, input, signOpts())),
        crossOrg: await caught(acceptCredentialSignature(tx, otherIssuer, f.credentialRowId, input, signOpts())),
        c: await credentialOf(tx, f.credentialRowId),
      };
    });
    expect(r.candidate).toMatchObject({ code: "FORBIDDEN" });
    expect(r.admin).toMatchObject({ code: "FORBIDDEN" });
    expect(r.crossOrg).toMatchObject({ code: "NOT_FOUND" });
    expect(r.c.pipelineStatus).toBe("AWAITING_SIGNATURE");
  });

  it("an issuer removed from the organisation after the guard ran cannot accept", async () => {
    const err = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const signature = await f.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      await tx.organisationMember.update({ where: { id: f.issuer.memberId! }, data: { status: "REMOVED", removedAt: new Date() } });
      return caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, signOpts()));
    });
    expect(err).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a wallet bound to a different member (operatorMemberId) is refused", async () => {
    const err = await inRollback(async (tx) => {
      const f = await approvedCredential(tx);
      const { member: colleague } = await mkMember(tx, f.orgId);
      const wallet = freshWallet();
      await addKey(tx, f.orgId, wallet, { operatorMemberId: colleague.id });
      return caught(signCredential(tx, f, wallet, { enqueue: false }));
    });
    expect(err).toMatchObject({ code: "FORBIDDEN" });
  });

  it("the candidate's version being replaced between prepare and accept blocks the signature", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const prep = await prepareCredentialSigning(tx, f.issuer, f.credentialRowId, { config: TEST_CONFIG, now: SIGN_NOW });
      const signature = await f.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      await updateClaim(tx, f.cand, f.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const err = await caught(acceptCredentialSignature(tx, f.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, signOpts()));
      return { err, c: await credentialOf(tx, f.credentialRowId) };
    });
    expect(r.err).toMatchObject({ code: "CONFLICT" });
    expect(r.c.pipelineStatus).toBe("AWAITING_SIGNATURE");
  });
});

describe("issuer key validity at signing time", () => {
  const sign = (opts: Parameters<typeof addKey>[3]) =>
    inRollback(async (tx) => {
      const f = await approvedCredential(tx);
      const wallet = freshWallet();
      await addKey(tx, f.orgId, wallet, opts);
      const err = await caught(signCredential(tx, f, wallet, { enqueue: false }));
      return { err, c: await credentialOf(tx, f.credentialRowId), atts: await tx.attestation.count({ where: { credentialRowId: f.credentialRowId } }) };
    });

  it("a retired key (validUntil before now) cannot sign a new credential", async () => {
    const r = await sign({ validUntil: new Date("2026-06-01T00:00:00Z") });
    expect(r.err).toMatchObject({ code: "FORBIDDEN" });
    expect(r.atts).toBe(0);
  });

  it("a key that is not yet valid at issuance cannot sign", async () => {
    const r = await sign({ validFrom: new Date("2026-12-01T00:00:00Z") });
    expect(r.err).toMatchObject({ code: "FORBIDDEN" });
    expect(r.c.pipelineStatus).toBe("AWAITING_SIGNATURE");
  });

  it("a compromised key cannot sign (even if the compromise is dated after issuance)", async () => {
    const early = await sign({ compromisedAt: new Date("2026-03-01T00:00:00Z") });
    const late = await sign({ compromisedAt: new Date("2026-10-30T00:00:00Z") });
    expect(early.err).toMatchObject({ code: "FORBIDDEN" });
    expect(late.err).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a key whose period starts exactly at issuedAt may sign (boundary inclusive)", async () => {
    const r = await sign({ validFrom: SIGN_NOW });
    expect(r.err).toBeNull();
    expect(r.c.pipelineStatus).toBe("SIGNED");
  });

  it("a key retiring exactly at issuedAt may not sign (boundary exclusive)", async () => {
    const r = await sign({ validUntil: SIGN_NOW });
    expect(r.err).toMatchObject({ code: "FORBIDDEN" });
  });

  it("retiring the key LATER never invalidates a signature made while it was valid", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      await signCredential(tx, f, f.wallet, { enqueue: false });
      const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
      // Rotation: the wallet is retired right after the signature.
      await tx.issuerKey.update({ where: { id: f.key.id }, data: { validUntil: new Date(SIGN_NOW.getTime() + 3600_000) } });
      const key = await tx.issuerKey.findUniqueOrThrow({ where: { id: f.key.id } });
      const c = await credentialOf(tx, f.credentialRowId);
      return { att, key, c };
    });
    // The attestation row and credential are untouched, and the historical check still passes.
    expect(r.c.pipelineStatus).toBe("SIGNED");
    expect(wasKeyValidForAttestation(r.key, r.att.issuedAt)).toBe(true);
    // ...while the same retired key can no longer produce NEW attestations (checked above).
  });

  it("a key compromised AFTER issuance fails the historical check only from compromisedAt onwards", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      await signCredential(tx, f, f.wallet, { enqueue: false });
      const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
      await tx.issuerKey.update({ where: { id: f.key.id }, data: { compromisedAt: new Date(SIGN_NOW.getTime() + 60_000) } });
      return { att, key: await tx.issuerKey.findUniqueOrThrow({ where: { id: f.key.id } }) };
    });
    expect(wasKeyValidForAttestation(r.key, r.att.issuedAt)).toBe(true); // signed before the compromise
    expect(wasKeyValidForAttestation(r.key, new Date(SIGN_NOW.getTime() + 61_000))).toBe(false);
  });
});

describe("supersession", () => {
  it("a first credential supersedes nothing (zero hash, no link)", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const { prep } = await signCredential(tx, f, f.wallet, { enqueue: false });
      return { prep, c: await credentialOf(tx, f.credentialRowId) };
    });
    expect(r.prep.typedData.message.supersedesCredentialId).toBe(ZERO_HASH);
    expect(r.c.supersedesCredentialId).toBeNull();
  });

  it("a newer attested version links to the previous SIGNED credential, in the message and in the row", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const first = await signCredential(tx, f, f.wallet, { enqueue: false });
      // The candidate edits, requests again, and the same issuer approves version 2.
      const edit = await updateClaim(tx, f.cand, f.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const req2 = await submitVerificationRequest(tx, f.cand, { claimId: f.claimId, claimVersionId: edit.claimVersionId, organisationId: f.orgId });
      const approved2 = await approveVerificationRequest(tx, f.issuer, req2.requestId, {}, APPROVE_NOW);
      const second = await signCredential(tx, { issuer: f.issuer, credentialRowId: approved2.credentialRowId }, f.wallet, { enqueue: false });
      return {
        first,
        second,
        c1: await credentialOf(tx, f.credentialRowId),
        c2: await credentialOf(tx, approved2.credentialRowId),
      };
    });
    expect(r.second.prep.typedData.message.supersedesCredentialId).toBe(r.c1.credentialId);
    expect(r.c2.supersedesCredentialId).toBe(r.c1.id);
    expect(r.c1.credentialId).not.toBe(r.c2.credentialId);
    expect(r.c1.pipelineStatus).toBe("SIGNED"); // the old credential is retained, never deleted
  });

  it("an earlier credential that was never signed is not superseded", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const edit = await updateClaim(tx, f.cand, f.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const req2 = await submitVerificationRequest(tx, f.cand, { claimId: f.claimId, claimVersionId: edit.claimVersionId, organisationId: f.orgId });
      const approved2 = await approveVerificationRequest(tx, f.issuer, req2.requestId, {}, APPROVE_NOW);
      return signCredential(tx, { issuer: f.issuer, credentialRowId: approved2.credentialRowId }, f.wallet, { enqueue: false });
    });
    expect(r.prep.typedData.message.supersedesCredentialId).toBe(ZERO_HASH);
  });
});

describe("audit trail and secrets", () => {
  it("writes CREDENTIAL_SIGNING_PREPARED and CREDENTIAL_SIGNED events that contain no salts, signatures or content", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const { signature } = await signCredential(tx, f, f.wallet, { enqueue: false });
      const c = await credentialOf(tx, f.credentialRowId);
      const events = await tx.auditEvent.findMany({ where: { targetId: f.credentialRowId } });
      return { events, c, signature, f };
    });
    expect(r.events.map((e) => e.action).sort()).toEqual(["CREDENTIAL_SIGNED", "CREDENTIAL_SIGNING_PREPARED"]);
    for (const e of r.events) expect(e).toMatchObject({ actorUserId: r.f.issuer.userId, actorRole: "ISSUER", organisationId: r.f.orgId });
    const text = JSON.stringify(r.events);
    for (const secret of [r.c.credentialSalt, r.c.contentSalt, r.c.subjectSalt, r.signature, "Software Engineer", "Acme"]) {
      expect(text).not.toContain(secret as string);
    }
  });
});

describe("derived columns are consistent with the stored content", () => {
  it("contentDigest equals the digest recomputed from the canonical content and contentSalt", async () => {
    const r = await inRollback(async (tx) => {
      const f = await ready(tx);
      const { prep } = await signCredential(tx, f, f.wallet, { enqueue: false });
      return { prep, c: await credentialOf(tx, f.credentialRowId) };
    });
    const m = r.prep.typedData.message;
    expect(contentDigestOf(m.content, m.content.contentSalt)).toBe(r.c.contentDigest);
    expect(m.credentialId).toBe(r.c.credentialId);
    expect(m.subjectCommitment).toBe(r.c.subjectCommitment);
  });
});
