import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { summariseStates } from "@/lib/verification/summary";
import { createClaim, submitVerificationRequest, updateClaim } from "@/server/candidate/claims";
import { confirmImport, previewImport } from "@/server/candidate/import";
import { saveProfile, setClaimVisibility } from "@/server/candidate/profile";
import { approveVerificationRequest, listIssuerRequests } from "@/server/issuer/review";
import { getPublicCredential, getPublicProfile } from "@/server/public/read";
import { deriveCandidateRecords, deriveIssuerHistory } from "@/server/verification/records";
import { db, inRollback, mkFinalizedTx, mkOrg, mkUser, type Tx } from "./helpers";
import { at, opts, org, sealAndAnchor, signed, anchorPulse } from "./evidence-helpers";
import { APPROVE_NOW, candidateActor, CLAIM_NOW, CONTINUING, EXPIRING, PERMANENT, signCredential } from "./issuance-helpers";

// Phase 11-13 database tests (always rolled back): profile and visibility, the import service, the public read services,
// the "earlier version verified" note and issuer history, over REAL signed and anchored evidence.

afterAll(async () => {
  await db.$disconnect();
});

const handle = () => "h" + randomBytes(6).toString("hex");
const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);
const newCandidate = async (tx: Tx) => candidateActor((await mkUser(tx, "CANDIDATE")).id);
const item = (over: Record<string, unknown> = {}) => ({ key: "i0", confirmed: true, ...PERMANENT, ...over });
const counts = async (tx: Tx) => ({
  claims: await tx.claim.count(),
  versions: await tx.claimVersion.count(),
  credentials: await tx.credential.count(),
  attestations: await tx.attestation.count(),
  anchors: await tx.anchor.count(),
  keys: await tx.issuerKey.count(),
  revocations: await tx.revocation.count(),
  organisations: await tx.organisation.count(),
});

describe("profile and visibility", () => {
  it("a new profile is private by default and handles are unique and validated", async () => {
    const r = await inRollback(async (tx) => {
      const a = await newCandidate(tx);
      const b = await newCandidate(tx);
      const h = handle();
      const created = await saveProfile(tx, a, { handle: h, displayName: "Priya Sharma" });
      const updated = await saveProfile(tx, a, { handle: h, displayName: "Priya S", headline: "Engineer", visibility: "PUBLIC" });
      return {
        created,
        updated,
        taken: await caught(saveProfile(tx, b, { handle: h, displayName: "Other" })),
        badHandle: await caught(saveProfile(tx, b, { handle: "Not Valid!", displayName: "X" })),
        reserved: await caught(saveProfile(tx, b, { handle: "admin", displayName: "X" })),
        noName: await caught(saveProfile(tx, b, { handle: handle(), displayName: "" })),
        issuer: await caught(saveProfile(tx, { ...a, role: "ISSUER" }, { handle: handle(), displayName: "X" })),
      };
    });
    expect(r.created.visibility).toBe("PRIVATE");
    expect(r.updated).toMatchObject({ displayName: "Priya S", visibility: "PUBLIC" });
    expect(r.taken).toMatchObject({ code: "VALIDATION", fieldErrors: { handle: expect.stringContaining("taken") } });
    expect(r.badHandle).toMatchObject({ code: "VALIDATION" });
    expect(r.reserved).toMatchObject({ code: "VALIDATION" });
    expect(r.noName).toMatchObject({ code: "VALIDATION" });
    expect(r.issuer).toMatchObject({ code: "FORBIDDEN" });
  });

  it("only the owner can change a record's visibility; another candidate's attempt is 'not found' and changes nothing", async () => {
    const r = await inRollback(async (tx) => {
      const a = await newCandidate(tx);
      const b = await newCandidate(tx);
      const { claimId } = await createClaim(tx, a, PERMANENT, CLAIM_NOW);
      const before = (await tx.claim.findUniqueOrThrow({ where: { id: claimId } })).visibility;
      const foreign = await caught(setClaimVisibility(tx, b, claimId, "PUBLIC"));
      const afterForeign = (await tx.claim.findUniqueOrThrow({ where: { id: claimId } })).visibility;
      const invalid = await caught(setClaimVisibility(tx, a, claimId, "EVERYONE"));
      await setClaimVisibility(tx, a, claimId, "UNLISTED");
      return { before, foreign, afterForeign, invalid, after: (await tx.claim.findUniqueOrThrow({ where: { id: claimId } })).visibility };
    });
    expect(r.before).toBe("PRIVATE");
    expect(r.foreign).toMatchObject({ code: "NOT_FOUND" });
    expect(r.afterForeign).toBe("PRIVATE");
    expect(r.invalid).toMatchObject({ code: "VALIDATION" });
    expect(r.after).toBe("UNLISTED");
  });
});

describe("professional-profile import", () => {
  it("previewing persists nothing and shows exact organisation matches only", async () => {
    const r = await inRollback(async (tx) => {
      const cand = await newCandidate(tx);
      await mkOrg(tx, "ACTIVE"); // "Test Org"
      const pending = await mkOrg(tx, "PENDING_ONBOARDING");
      await tx.organisation.update({ where: { id: pending.id }, data: { displayName: "Not Yet Ltd", legalName: "Not Yet Ltd" } });
      const before = await counts(tx);
      const text = `Experience\nEngineer\nTest Org\n2020-03-10 - 2021-04-12\n\nExperience\nEngineer\nTest Organisation Limited\n2019-03-10 - 2020-04-12\n\nExperience\nAnalyst\nNot Yet Ltd\n2018-03-10 - 2019-04-12`;
      const preview = await previewImport(tx, cand, text, CLAIM_NOW);
      return { preview, before, after: await counts(tx) };
    });
    expect(r.after).toEqual(r.before);
    expect(r.preview.items).toHaveLength(3);
    expect(r.preview.items[0].matchedOrganisation).toMatchObject({ displayName: "Test Org" });
    expect(r.preview.items[1].matchedOrganisation).toBeNull(); // a fuzzy match is never offered
    expect(r.preview.items[2].matchedOrganisation).toBeNull(); // only ACTIVE organisations can match
  });

  it("a confirmed import creates SELF_DECLARED claims through the Phase 4 service, and nothing that implies verification", async () => {
    const r = await inRollback(async (tx) => {
      const cand = await newCandidate(tx);
      const before = await counts(tx);
      const outcome = await confirmImport(tx, cand, [item({ title: "Engineer" }), item({ key: "i1", title: "Analyst", startDate: "2015-01-05", endDate: "2016-01-05" })], CLAIM_NOW);
      const claims = await tx.claim.findMany({ where: { candidateId: cand.userId }, include: { versions: true } });
      const records = await deriveCandidateRecords(tx, cand, undefined, opts(at(1)));
      const audits = await tx.auditEvent.findMany({ where: { actorUserId: cand.userId }, select: { action: true, metadata: true } });
      return { outcome, before, after: await counts(tx), claims, records, audits };
    });
    expect(r.outcome).toMatchObject({ created: 2, skipped: 0, invalid: 0 });
    expect(r.claims).toHaveLength(2);
    for (const c of r.claims) {
      expect(c.visibility).toBe("PRIVATE");
      expect(c.versions).toHaveLength(1);
      expect(c.versions[0].versionNumber).toBe(1);
      expect(c.versions[0].authoredBy).toBe("CANDIDATE");
    }
    expect(r.records.records.map((x) => x.result?.state)).toEqual(["SELF_DECLARED", "SELF_DECLARED"]);
    // no credential, attestation, anchor, issuer key, revocation or organisation came into being
    expect({ ...r.after, claims: 0, versions: 0 }).toEqual({ ...r.before, claims: 0, versions: 0 });
    expect(r.after.claims - r.before.claims).toBe(2);
    expect(r.audits.map((a) => a.action)).toEqual(expect.arrayContaining(["CLAIM_CREATED", "PROFILE_IMPORT_CONFIRMED"]));
    expect(JSON.stringify(r.audits)).not.toContain("Engineer"); // audit metadata holds counts, never content
  });

  it("only selected AND confirmed records are stored; invalid ones are reported without blocking the rest", async () => {
    const r = await inRollback(async (tx) => {
      const cand = await newCandidate(tx);
      const outcome = await confirmImport(
        tx,
        cand,
        [item({ key: "ok" }), item({ key: "unconfirmed", title: "Other", confirmed: false }), item({ key: "bad", title: "Bad", startDate: "" })],
        CLAIM_NOW,
      );
      return { outcome, stored: await tx.claimVersion.findMany({ where: { claim: { candidateId: cand.userId } }, select: { content: true } }) };
    });
    expect(r.outcome.created).toBe(1);
    expect(r.outcome.results.find((x) => x.key === "unconfirmed")).toMatchObject({ status: "INVALID", errors: { confirmed: expect.any(String) } });
    expect(r.outcome.results.find((x) => x.key === "bad")).toMatchObject({ status: "INVALID", errors: { startDate: expect.any(String) } });
    expect(r.stored).toHaveLength(1);
  });

  it("is idempotent: a retry or double submit, an existing record and a repeat inside one batch create no duplicate", async () => {
    const r = await inRollback(async (tx) => {
      const cand = await newCandidate(tx);
      await createClaim(tx, cand, { ...PERMANENT, title: "Existing Role", organisationName: "Existing Co" }, CLAIM_NOW);
      const batch = [item({ key: "a" }), item({ key: "a-again", title: "  SOFTWARE engineer ", organisationName: "acme ltd." }), item({ key: "existing", title: "existing role", organisationName: "EXISTING CO" })];
      const first = await confirmImport(tx, cand, batch, CLAIM_NOW);
      const retry = await confirmImport(tx, cand, batch, CLAIM_NOW);
      const changed = await confirmImport(tx, cand, [item({ key: "d", endDate: "2024-04-30" })], CLAIM_NOW);
      return { first, retry, changed, total: await tx.claim.count({ where: { candidateId: cand.userId } }) };
    });
    expect(r.first.results.map((x) => x.status)).toEqual(["CREATED", "SKIPPED_DUPLICATE", "SKIPPED_DUPLICATE"]);
    expect(r.retry).toMatchObject({ created: 0, skipped: 3 });
    expect(r.changed.created).toBe(1); // a different end date is a different record
    expect(r.total).toBe(3);
  });

  it("the preview marks records already on the profile", async () => {
    const r = await inRollback(async (tx) => {
      const cand = await newCandidate(tx);
      await createClaim(tx, cand, PERMANENT, CLAIM_NOW);
      return previewImport(tx, cand, `Experience\n${PERMANENT.title}\n${PERMANENT.organisationName}\n2022-01-10 - 2024-03-31`, CLAIM_NOW);
    });
    expect(r.items[0].duplicate).toBe(true);
  });

  it("always imports into the CALLER's own profile; other roles and malformed batches are refused", async () => {
    const r = await inRollback(async (tx) => {
      const a = await newCandidate(tx);
      const b = await newCandidate(tx);
      await confirmImport(tx, b, [item({ userId: a.userId, candidateId: a.userId, role: "ADMIN" })], CLAIM_NOW);
      return {
        a: await tx.claim.count({ where: { candidateId: a.userId } }),
        b: await tx.claim.count({ where: { candidateId: b.userId } }),
        issuer: await caught(confirmImport(tx, { ...a, role: "ISSUER" }, [item()], CLAIM_NOW)),
        admin: await caught(previewImport(tx, { ...a, role: "ADMIN" }, "x", CLAIM_NOW)),
        empty: await caught(confirmImport(tx, a, [], CLAIM_NOW)),
        tooMany: await caught(confirmImport(tx, a, Array.from({ length: 101 }, (_, i) => item({ key: `k${i}` })), CLAIM_NOW)),
        notArray: await caught(confirmImport(tx, a, "nope", CLAIM_NOW)),
      };
    });
    expect(r.a).toBe(0);
    expect(r.b).toBe(1);
    expect(r.issuer).toMatchObject({ code: "FORBIDDEN" });
    expect(r.admin).toMatchObject({ code: "FORBIDDEN" });
    for (const e of [r.empty, r.tooMany, r.notArray]) expect(e).toMatchObject({ code: "VALIDATION" });
  });
});

describe("public profile", () => {
  async function scenario(tx: Tx) {
    const ctx = await org(tx);
    const f = await signed(tx, ctx); // verified once anchored; owned by f.cand
    const owner = f.cand;
    const h = handle();
    await saveProfile(tx, owner, { handle: h, displayName: "Priya Sharma", headline: "Engineer", visibility: "PUBLIC" });
    await setClaimVisibility(tx, owner, f.claimId, "PUBLIC");
    const declared = await createClaim(tx, owner, { ...PERMANENT, title: "Self Declared Role", organisationName: "Nowhere Inc" }, CLAIM_NOW);
    await setClaimVisibility(tx, owner, declared.claimId, "PUBLIC");
    const privateClaim = await createClaim(tx, owner, { ...PERMANENT, title: "Private Role", organisationName: "Hidden Inc" }, CLAIM_NOW);
    const unlisted = await createClaim(tx, owner, { ...PERMANENT, title: "Unlisted Role", organisationName: "Quiet Inc" }, CLAIM_NOW);
    await setClaimVisibility(tx, owner, unlisted.claimId, "UNLISTED");
    return { ctx, f, owner, h, declared, privateClaim, unlisted };
  }

  it("lists only what the owner published, groups verified apart from self-declared, and uses the derived state", async () => {
    const r = await inRollback(async (tx) => {
      const s = await scenario(tx);
      await sealAndAnchor(tx, s.ctx, at(2));
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: s.f.credentialRowId } });
      const view = await getPublicProfile(tx, s.h.toUpperCase(), opts(at(5)));
      return { s, view, cred, unknown: await getPublicProfile(tx, "nobody-here", opts(at(5))), malformed: await getPublicProfile(tx, "../etc", opts(at(5))) };
    });
    const v = r.view!;
    expect(v.displayName).toBe("Priya Sharma");
    expect(v.records.map((x) => x.title).sort()).toEqual(["Self Declared Role", "Software Engineer"]);
    const verified = v.records.find((x) => x.title === "Software Engineer")!;
    const declared = v.records.find((x) => x.title === "Self Declared Role")!;
    expect(verified).toMatchObject({ group: "VERIFIED", verifyRef: r.cred.credentialId });
    expect(verified.result.state).toBe("PERMANENT_VALID");
    expect(declared).toMatchObject({ group: "SELF_DECLARED", verifyRef: null });
    expect(declared.result.state).toBe("SELF_DECLARED");
    expect(v.records.some((x) => x.title === "Private Role" || x.title === "Unlisted Role")).toBe(false);
    expect(r.unknown).toBeNull();
    expect(r.malformed).toBeNull();
    // nothing private leaks into the public shape
    const json = JSON.stringify(v);
    for (const secret of [r.cred.credentialSalt!, r.cred.contentSalt!, r.cred.subjectSalt!, r.s.owner.userId, r.s.f.claimId, r.s.declared.claimId, r.s.f.credentialRowId]) expect(json).not.toContain(secret);
    expect(json).not.toMatch(/pipelineStatus|authUserId|notes|"checks"\s*:\s*\[\s*\{[^}]*salt/);
  });

  it("a private profile does not exist publicly; an unlisted one resolves but must not be indexed", async () => {
    const r = await inRollback(async (tx) => {
      const s = await scenario(tx);
      await saveProfile(tx, s.owner, { handle: s.h, displayName: "Priya Sharma", visibility: "PRIVATE" });
      const hidden = await getPublicProfile(tx, s.h, opts(at(5)));
      await saveProfile(tx, s.owner, { handle: s.h, displayName: "Priya Sharma", visibility: "UNLISTED" });
      return { hidden, unlisted: await getPublicProfile(tx, s.h, opts(at(5))) };
    });
    expect(r.hidden).toBeNull();
    expect(r.unlisted?.indexable).toBe(false);
  });

  it("a stored 'ANCHORED' pipeline status without finalized evidence is never shown as verified", async () => {
    const r = await inRollback(async (tx) => {
      const s = await scenario(tx); // signed, NOT anchored
      await tx.credential.update({ where: { id: s.f.credentialRowId }, data: { pipelineStatus: "ANCHORED" } });
      const view = await getPublicProfile(tx, s.h, opts(at(5)));
      return view!.records.find((x) => x.title === "Software Engineer")!;
    });
    expect(r.result.state).toBe("PENDING");
    expect(r.group).toBe("SELF_DECLARED");
    expect(r.result.organisation).toBeNull(); // a pending request is not attributed publicly
  });
});

describe("public credential verifier", () => {
  it("answers only for records the owner published; private and unknown look the same", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const ref = (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).credentialId!;
      const hidden = await getPublicCredential(tx, ref, opts(at(5)));
      await setClaimVisibility(tx, f.cand, f.claimId, "UNLISTED");
      const unlisted = await getPublicCredential(tx, ref, opts(at(5)));
      await setClaimVisibility(tx, f.cand, f.claimId, "PUBLIC");
      await saveProfile(tx, f.cand, { handle: handle(), displayName: "Priya Sharma", visibility: "PUBLIC" });
      const pub = await getPublicCredential(tx, ref.toUpperCase().replace("0X", "0x"), opts(at(5)));
      return { ref, hidden, unlisted, pub, unknown: await getPublicCredential(tx, "0x" + "ab".repeat(32), opts(at(5))), bad: [await getPublicCredential(tx, "0x12", opts(at(5))), await getPublicCredential(tx, "nope", opts(at(5))), await getPublicCredential(tx, null, opts(at(5)))] };
    });
    expect(r.hidden).toBeNull();
    expect(r.unknown).toBeNull();
    expect(r.bad).toEqual([null, null, null]);
    expect(r.unlisted?.result.state).toBe("PERMANENT_VALID");
    expect(r.unlisted?.holder).toBeNull(); // no profile, so no name
    expect(r.pub?.holder).toMatchObject({ displayName: "Priya Sharma", handle: expect.any(String) });
  });

  it("the page data and the evidence bundle come from the Phase 10 result and contain no private field", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      const { anchor } = await sealAndAnchor(tx, ctx, at(2));
      await setClaimVisibility(tx, f.cand, f.claimId, "PUBLIC");
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
      const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
      const anchorTx = await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: anchor.transactionId } });
      const view = await getPublicCredential(tx, cred.credentialId, opts(at(5)));
      return { view: view!, cred, att, anchorTx, cand: f.cand };
    });
    const { view, cred, att, anchorTx } = r;
    expect(view.result.state).toBe("PERMANENT_VALID");
    expect(view.bundle!.derivedState.state).toBe(view.result.state);
    expect(view.bundle!.anchorEvidence).toMatchObject({ transactionHash: anchorTx.txHash, transactionStatus: "FINALIZED" });
    expect(view.bundle!.credential.credentialId).toBe(cred.credentialId);
    expect(view.record.title).toBe("Software Engineer");
    const json = JSON.stringify(view);
    for (const secret of [cred.credentialSalt!, cred.contentSalt!, cred.subjectSalt!, att.nonce, r.cand.userId, cred.id]) expect(json).not.toContain(secret);
    expect(json).not.toMatch(/pipelineStatus|authUserId|reviewer|sourceOfTruth/i);
  });

  async function published(tx: Tx, draft: Record<string, unknown>) {
    const ctx = await org(tx);
    const f = await signed(tx, ctx, draft);
    await setClaimVisibility(tx, f.cand, f.claimId, "PUBLIC");
    const ref = (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).credentialId!;
    return { ctx, f, ref, at: async (days: number) => (await getPublicCredential(tx, ref, opts(at(days))))! };
  }

  it("a finalized revocation is shown as revoked, with its transaction in the evidence", async () => {
    const r = await inRollback(async (tx) => {
      const p = await published(tx, PERMANENT);
      await sealAndAnchor(tx, p.ctx, at(2));
      const before = await p.at(3);
      const rtx = await mkFinalizedTx(tx, "REVOKE_CREDENTIAL", p.ctx.orgId, "CREDENTIAL", p.f.credentialRowId);
      await tx.revocation.create({ data: { credentialRowId: p.f.credentialRowId, organisationId: p.ctx.orgId, revokerKeyId: p.ctx.keyId, reasonCode: "FRAUD", transactionId: rtx.id, blockNumber: 3n, revokedAt: at(4) } });
      return { before, after: await p.at(5), rtx };
    });
    expect(r.before.result.state).toBe("PERMANENT_VALID");
    expect(r.after.result.state).toBe("REVOKED");
    expect(r.after.bundle!.revocation).toMatchObject({ transactionHash: r.rtx.txHash });
  });

  it("an expiring credential is verified until its expiry date, then expired", async () => {
    const r = await inRollback(async (tx) => {
      const p = await published(tx, EXPIRING);
      await sealAndAnchor(tx, p.ctx, at(2));
      return { valid: await p.at(5), expired: await p.at(500) };
    });
    expect(r.valid.result.state).toBe("VERIFIED");
    expect(r.expired.result.state).toBe("EXPIRED");
  });

  it("a current relationship is confirmed while fresh and needs a refresh afterwards", async () => {
    const r = await inRollback(async (tx) => {
      const p = await published(tx, CONTINUING);
      await anchorPulse(tx, p.ctx, at(1));
      return { fresh: await p.at(10), stale: await p.at(60) };
    });
    expect(r.fresh.result.state).toBe("CURRENTLY_ATTESTED");
    expect(r.stale.result.state).toBe("STALE_NO_RECENT_ATTESTATION");
  });

  it("an older version is shown as modified, and the page can say a newer version exists", async () => {
    const r = await inRollback(async (tx) => {
      const p = await published(tx, PERMANENT);
      await sealAndAnchor(tx, p.ctx, at(2));
      const edited = await updateClaim(tx, p.f.cand, p.f.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const { requestId } = await submitVerificationRequest(tx, p.f.cand, { claimId: p.f.claimId, claimVersionId: edited.claimVersionId, organisationId: p.ctx.orgId });
      const approved = await approveVerificationRequest(tx, p.ctx.issuer, requestId, {}, APPROVE_NOW);
      await signCredential(tx, { ...p.f, credentialRowId: approved.credentialRowId }, p.ctx.wallet);
      return p.at(5);
    });
    expect(r.result.state).toBe("MODIFIED");
    expect(r.isCurrentVersion).toBe(false);
  });
});

describe("earlier-version note, dashboard counts and issuer history", () => {
  it("an edited, previously verified record is not shown as verified, and says an earlier version was", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const verified = await deriveCandidateRecords(tx, f.cand, undefined, opts(at(3)));

      const edited = await updateClaim(tx, f.cand, f.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const unrequested = await deriveCandidateRecords(tx, f.cand, undefined, opts(at(3)));
      const { requestId } = await submitVerificationRequest(tx, f.cand, { claimId: f.claimId, claimVersionId: edited.claimVersionId, organisationId: ctx.orgId });
      const pending = await deriveCandidateRecords(tx, f.cand, undefined, opts(at(3)));
      const approved = await approveVerificationRequest(tx, ctx.issuer, requestId, {}, APPROVE_NOW);
      await signCredential(tx, { ...f, credentialRowId: approved.credentialRowId }, ctx.wallet);
      const signedNotAnchored = await deriveCandidateRecords(tx, f.cand, undefined, opts(at(3)));
      await sealAndAnchor(tx, ctx, at(4));
      const done = await deriveCandidateRecords(tx, f.cand, undefined, opts(at(5)));
      return { verified, unrequested, pending, signedNotAnchored, done };
    });
    const rec = (x: { records: Awaited<ReturnType<typeof deriveCandidateRecords>>["records"] }) => x.records[0];
    expect(rec(r.verified).result?.state).toBe("PERMANENT_VALID");
    expect(rec(r.verified).earlierVerified).toBeNull();

    for (const stage of [r.unrequested, r.pending, r.signedNotAnchored]) {
      expect(["SELF_DECLARED", "PENDING"]).toContain(rec(stage).result?.state);
      expect(rec(stage).earlierVerified).toMatchObject({ versionNumber: 1, organisationName: "Test Org" });
      expect(rec(stage).versions[1].credentialResult?.state).toMatch(/PERMANENT_VALID|MODIFIED/); // history keeps the old evidence
    }
    expect(rec(r.unrequested).result?.state).toBe("SELF_DECLARED");
    expect(rec(r.pending).result?.state).toBe("PENDING");
    expect(rec(r.done).result?.state).toBe("PERMANENT_VALID");
    expect(rec(r.done).earlierVerified).toBeNull();
    expect(rec(r.done).versions[1].credentialResult?.state).toBe("MODIFIED");
  });

  it("dashboard counts equal the derived states of the candidate's own records", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const own = f.cand;
      await createClaim(tx, own, { ...PERMANENT, title: "Declared A", organisationName: "A Co" }, CLAIM_NOW);
      await createClaim(tx, own, { ...PERMANENT, title: "Declared B", organisationName: "B Co" }, CLAIM_NOW);
      const asked = await createClaim(tx, own, { ...PERMANENT, title: "Asked", organisationName: "C Co" }, CLAIM_NOW);
      await submitVerificationRequest(tx, own, { claimId: asked.claimId, claimVersionId: asked.claimVersionId, organisationId: ctx.orgId });
      // someone else's records never count
      const other = await newCandidate(tx);
      await createClaim(tx, other, PERMANENT, CLAIM_NOW);
      const { records } = await deriveCandidateRecords(tx, own, undefined, opts(at(3)));
      return { records, counts: summariseStates(records.flatMap((x) => (x.result ? [x.result.state] : []))) };
    });
    expect(r.records).toHaveLength(4);
    expect(r.counts).toMatchObject({ total: 4, verified: 1, pending: 1, selfDeclared: 2, needsRefresh: 0 });
  });

  it("issuer history is scoped to the issuer's own organisation", async () => {
    const r = await inRollback(async (tx) => {
      const a = await org(tx);
      const b = await org(tx);
      const fa = await signed(tx, a);
      await sealAndAnchor(tx, a, at(2));
      await signed(tx, b);
      const requestsA = await listIssuerRequests(tx, a.issuer, "all");
      const history = await deriveIssuerHistory(tx, a.issuer, opts(at(3)));
      const foreign = await caught(deriveIssuerHistory(tx, candidateActor((await mkUser(tx, "CANDIDATE")).id), opts(at(3))));
      return { history, fa, requestsA, foreign };
    });
    expect(r.history.rows).toHaveLength(1);
    expect(r.history.rows[0]).toMatchObject({ id: r.fa.credentialRowId });
    expect(r.history.rows[0].result?.state).toBe("PERMANENT_VALID");
    expect(r.requestsA).toHaveLength(1); // the inbox shows only this organisation's requests
    expect(r.foreign).toMatchObject({ code: "FORBIDDEN" });
  });
});
