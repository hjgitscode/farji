import { afterAll, describe, expect, it } from "vitest";
import { encodeRevokeCredential, registryInterface } from "@/lib/blockchain/registry";
import { credentialIdOf } from "@/lib/crypto/commitments";
import { acceptCredentialSignature, prepareCredentialSigning } from "@/server/issuance/signing";
import { buildTransaction, recordSubmittedTransaction } from "@/server/chain/transactions";
import { rescanRange } from "@/server/chain/sync";
import { sealCohortBatch } from "@/server/merkle/cohort";
import { db, inRollback, type Tx } from "../db/helpers";
import { addKey, approvedCredential, PERMANENT, type Fixture } from "../db/issuance-helpers";
import { adminActor, buildSendRecord, chainNowSeconds, env, finalise, fund, mine, onboard, recordOpts, send, signingClock, sync, type Onboarded } from "./harness";
import { Wallet } from "ethers";

afterAll(async () => {
  await db.$disconnect();
});

const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);
const rpcCall = <T>(method: string, params: unknown[] = []) => env().provider.send(method, params) as Promise<T>;

/** The registry custom error behind a failed raw call, decoded from the revert data. */
function revertName(e: unknown): string {
  const data = (e as { data?: string })?.data;
  if (typeof data === "string" && data.length >= 10) {
    const parsed = registryInterface.parseError(data);
    if (parsed) return parsed.name;
  }
  return `(unknown) ${String((e as Error)?.message).slice(0, 120)}`;
}

/**
 * Broadcasts a transaction that is expected to be MINED AND REVERT. In automine mode Hardhat answers such a
 * submission with an error that still names the mined transaction; the hash is what a wallet would report.
 */
async function sendReverting(wallet: Wallet, built: Parameters<typeof send>[1], over: Parameters<typeof send>[2]): Promise<string> {
  try {
    return (await send(wallet, built, over)).hash;
  } catch (e) {
    const m = /"txHash":\s*"(0x[0-9a-fA-F]{64})"/.exec(String((e as Error).message));
    if (!m) throw e;
    return m[1];
  }
}

async function signOnChain(tx: Tx, o: Onboarded, f: Fixture, clock?: Date, wallet: Wallet = o.wallet) {
  const e = env();
  const now = clock ?? (await signingClock());
  const prep = await prepareCredentialSigning(tx, o.issuer, f.credentialRowId, { config: e.eip, now });
  const signature = await wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  const accepted = await acceptCredentialSignature(tx, o.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, { config: e.eip, now, chain: e.reader });
  return { accepted, now, prep };
}

describe("revocation ownership on a real chain", () => {
  it("the issuing organisation revokes; the Revocation row appears only at FINALIZED; the Credential is untouched", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const { now } = await signOnChain(tx, o, f);
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });

      const rev = await buildSendRecord(tx, o.issuer, o.wallet, "REVOKE_CREDENTIAL", cred.id, { reason: "FRAUD" }, now);
      await sync(tx, rev.rec.id);
      const early = await tx.revocation.count({ where: { organisationId: o.org.id } });
      await finalise(tx, rev.rec.id);

      const onChain = await e.registry.getRevocation(cred.credentialId!);
      const again = await caught(buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, o.issuer, "REVOKE_CREDENTIAL", cred.id, { reason: "FRAUD" }, { now }));
      return { o, cred, early, onChain, rows: await tx.revocation.findMany({ where: { organisationId: o.org.id } }), after: await tx.credential.findUniqueOrThrow({ where: { id: cred.id } }), again, attestations: await tx.attestation.count({ where: { credentialRowId: cred.id } }) };
    });
    expect(r.early).toBe(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ credentialRowId: r.cred.id, reasonCode: "FRAUD" });
    expect(r.onChain.orgId).toBe(r.o.org.orgId);
    expect(r.onChain.reasonCode).toBe(2n);
    expect(r.after).toEqual(r.cred); // nothing deleted or rewritten
    expect(r.attestations).toBe(1);
    expect(r.again).toMatchObject({ code: "CONFLICT" });
  });

  it("another organisation cannot revoke it - not through the app and not on-chain - and its own-namespace attempt revokes a DIFFERENT id", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const a = await onboard(tx);
      const b = await onboard(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: a.org.id, issuer: a.issuer });
      const { now } = await signOnChain(tx, a, f);
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });

      // 1. The app: B's issuer cannot even build it.
      const build = await caught(buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, b.issuer, "REVOKE_CREDENTIAL", cred.id, { reason: "FRAUD" }, { now }));

      // 2. The chain: B's wallet calling revokeCredential with A's orgId reverts with NotOpenIssuerOf.
      const wrongOrg = await caught(b.wallet.sendTransaction({ to: e.cfg.registry, data: encodeRevokeCredential(a.org.orgId, cred.credentialSalt!, "FRAUD") }));

      // 3. B revokes with ITS OWN orgId and A's salt: succeeds, but only in B's namespace.
      const fromBlock = await e.provider.getBlockNumber();
      const own = await b.wallet.sendTransaction({ to: e.cfg.registry, data: encodeRevokeCredential(b.org.orgId, cred.credentialSalt!, "OTHER") });
      await own.wait();
      await mine(2);
      const idInB = credentialIdOf(b.org.orgId, cred.credentialSalt!);

      // 4. The mirror never marks A's credential: B's transaction was never recorded by the app, and a rescan does not guess.
      const rescan = await rescanRange(tx, { cfg: e.cfg, rpc: e.rpc }, await adminActor(tx), { fromBlock, toBlock: await e.provider.getBlockNumber() });
      return {
        build,
        wrongOrg: revertName(wrongOrg),
        idA: await e.registry.getRevocation(cred.credentialId!),
        idB: await e.registry.getRevocation(idInB),
        idInB,
        rescan,
        ownHash: own.hash.toLowerCase(),
        revocations: await tx.revocation.count({ where: { credentialRowId: cred.id } }),
        recordedOwn: await tx.blockchainTransaction.count({ where: { txHash: own.hash.toLowerCase() } }),
        b,
        cred,
      };
    });
    expect(r.build).toMatchObject({ code: "NOT_FOUND" });
    expect(r.wrongOrg).toBe("NotOpenIssuerOf");
    expect(r.idA.orgId).toBe("0x" + "00".repeat(32)); // A's credential id is NOT revoked on-chain
    expect(r.idB.orgId).toBe(r.b.org.orgId); // B only revoked an id in its own namespace
    expect(r.idInB).not.toBe(r.cred.credentialId);
    expect(r.rescan.unattributed).toContain(r.ownHash);
    expect(r.rescan.adopted).toBe(0);
    expect(r.revocations).toBe(0);
    expect(r.recordedOwn).toBe(0);
  });

  it("while SUSPENDED the app refuses new anchors and revocations (D32), but the contract itself still lets the issuer wallet revoke", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const { now } = await signOnChain(tx, o, f);
      const sealed = await sealCohortBatch(tx, o.issuer, { now });
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });

      const sus = await buildSendRecord(tx, o.admin, e.adminWallet, "SET_ORGANISATION_STATUS", o.org.id, { status: "SUSPENDED" });
      await finalise(tx, sus.rec.id);
      const status = (await tx.organisation.findUniqueOrThrow({ where: { id: o.org.id } })).status;

      const build = (purpose: "ANCHOR_COHORT" | "REVOKE_CREDENTIAL", id: string, params = {}) => caught(buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, o.issuer, purpose, id, params, { now }));
      const anchor = await build("ANCHOR_COHORT", sealed.batchId);
      const appRevoke = await build("REVOKE_CREDENTIAL", cred.id, { reason: "RECORD_CORRECTED" });

      // The contract: new anchors are refused, revocation is permitted while suspended (history stays correctable).
      const rawAnchor = await caught(o.wallet.sendTransaction({ to: e.cfg.registry, data: registryInterface.encodeFunctionData("anchorCohortRoot", [o.org.orgId, sealed.batchRoot, sealed.leafCount, "0x" + "11".repeat(32), "0x" + "00".repeat(32)]) }));
      const rawRevoke = await o.wallet.sendTransaction({ to: e.cfg.registry, data: encodeRevokeCredential(o.org.orgId, cred.credentialSalt!, "RECORD_CORRECTED") });
      await rawRevoke.wait();
      return { status, anchor, appRevoke, rawAnchor: revertName(rawAnchor), onChain: await e.registry.getRevocation(cred.credentialId!), org: o.org };
    });
    expect(r.status).toBe("SUSPENDED");
    expect(r.anchor).toMatchObject({ code: "FORBIDDEN" });
    expect(r.appRevoke).toMatchObject({ code: "FORBIDDEN" });
    expect(r.rawAnchor).toBe("OrganisationNotActive");
    expect(r.onChain.orgId).toBe(r.org.orgId);
  });
});

describe("stale chain head", () => {
  it("a second anchor built on the same head reverts on-chain (FAILED); rebuilding on the new head succeeds", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const mk = async () => {
        const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
        const { now } = await signOnChain(tx, o, f);
        return { f, sealed: await sealCohortBatch(tx, o.issuer, { now }), now };
      };
      const one = await mk();
      const two = await mk();

      // Both transactions are built while the chain head is still the zero hash.
      const b1 = await buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, o.issuer, "ANCHOR_COHORT", one.sealed.batchId, {}, { now: two.now });
      const b2 = await buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, o.issuer, "ANCHOR_COHORT", two.sealed.batchId, {}, { now: two.now });
      const s1 = await send(o.wallet, b1);
      const hash2 = await sendReverting(o.wallet, b2, { gasLimit: 600000n, nonce: s1.nonce + 1 }); // forced past estimation: it is mined, and reverts
      const record = (hash: string, id: string) => recordSubmittedTransaction(tx, { cfg: e.cfg, rpc: e.rpc, reader: e.reader }, o.issuer, { purpose: "ANCHOR_COHORT", targetId: id, txHash: hash }, { ...recordOpts, now: two.now });
      const r1 = await record(s1.hash, one.sealed.batchId);
      const r2 = await record(hash2, two.sealed.batchId);

      const failed = await finalise(tx, r2.id);
      const first = await finalise(tx, r1.id);
      const failedRow = await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: r2.id } });
      const batchAfterFail = (await tx.cohortBatch.findUniqueOrThrow({ where: { id: two.sealed.batchId } })).status;

      // Retry: a NEW transaction built on the new head.
      const retry = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_COHORT", two.sealed.batchId, {}, two.now);
      await finalise(tx, retry.rec.id);
      return {
        b1,
        b2,
        failed,
        first,
        failedRow,
        batchAfterFail,
        retryData: retry.built.data,
        anchors: await tx.anchor.findMany({ where: { organisationId: o.org.id }, orderBy: { epoch: "asc" } }),
        batch2: await tx.cohortBatch.findUniqueOrThrow({ where: { id: two.sealed.batchId } }),
        head: await e.reader.getChainHead(o.org.orgId, "COHORT"),
        cred2: (await tx.credential.findUniqueOrThrow({ where: { id: two.f.credentialRowId } })).pipelineStatus,
      };
    });
    expect(r.b1.data).not.toBe(r.b2.data);
    expect(r.failed.status).toBe("FAILED");
    expect(r.failedRow.failureReason).toMatch(/reverted/);
    expect(r.first.status).toBe("FINALIZED");
    expect(r.batchAfterFail).toBe("SEALED"); // the failed attempt anchored nothing
    expect(r.anchors.map((a) => a.epoch)).toEqual([1, 2]);
    expect(r.anchors[1].previousChainRoot).toBe(r.anchors[0].chainRoot);
    expect(r.batch2).toMatchObject({ status: "ANCHORED", anchorId: r.anchors[1].id });
    expect(r.head.epoch).toBe(2n);
    expect(r.cred2).toBe("ANCHORED");
    expect(r.retryData).toMatch(/^0x/);
  });
});

describe("reorg, replacement and dropped transactions on a real node", () => {
  it("a reorg removes a mined anchor: PENDING again, nothing mirrored; a replacement at the same nonce later makes it DROPPED", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const { now } = await signOnChain(tx, o, f);
      const sealed = await sealCohortBatch(tx, o.issuer, { now });

      const snapshot = await rpcCall<string>("evm_snapshot");
      const a = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_COHORT", sealed.batchId, {}, now);
      const confirmed = (await sync(tx, a.rec.id)).status;

      // The block is orphaned.
      await rpcCall<boolean>("evm_revert", [snapshot]);
      const afterReorg = await sync(tx, a.rec.id);
      const row = await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: a.rec.id } });

      // A different transaction takes the same nonce; once that is final the original is DROPPED.
      const replacement = await o.wallet.sendTransaction({ to: o.wallet.address, value: 0, nonce: a.sent.nonce });
      await replacement.wait();
      const dropped = await finalise(tx, a.rec.id);
      return {
        confirmed,
        afterReorg,
        row,
        dropped,
        final: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: a.rec.id } }),
        anchors: await tx.anchor.count({ where: { organisationId: o.org.id } }),
        batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status,
        cred: (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).pipelineStatus,
        onChain: await e.reader.getChainHead(o.org.orgId, "COHORT"),
      };
    });
    expect(r.confirmed).toBe("CONFIRMED");
    expect(r.afterReorg.status).toBe("PENDING");
    expect(r.row).toMatchObject({ blockNumber: null, blockHash: null, confirmedAt: null });
    expect(r.dropped.status).toBe("DROPPED");
    expect(r.final.failureReason).toMatch(/replaced/);
    expect(r.anchors).toBe(0);
    expect(r.batch).toBe("SEALED");
    expect(r.cred).toBe("QUEUED_FOR_ANCHOR");
    expect(r.onChain.epoch).toBe(0n); // nothing was anchored on the chain
  });

  it("a transaction dropped from the mempool and replaced is DROPPED; the retry (a new transaction) can then finalise", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const { now } = await signOnChain(tx, o, f);
      const sealed = await sealCohortBatch(tx, o.issuer, { now });

      await rpcCall("evm_setAutomine", [false]);
      let pendingStatus = "";
      let droppedRow;
      try {
        const a = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_COHORT", sealed.batchId, {}, now);
        pendingStatus = (await sync(tx, a.rec.id)).status; // in the mempool: still PENDING
        await rpcCall("hardhat_dropTransaction", [a.sent.hash]);
        await rpcCall("evm_setAutomine", [true]);
        const replacement = await o.wallet.sendTransaction({ to: o.wallet.address, value: 0, nonce: a.sent.nonce });
        await replacement.wait();
        droppedRow = await finalise(tx, a.rec.id);
      } finally {
        await rpcCall("evm_setAutomine", [true]);
      }
      const retry = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_COHORT", sealed.batchId, {}, now);
      await finalise(tx, retry.rec.id);
      return { pendingStatus, droppedRow, batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status, head: await e.reader.getChainHead(o.org.orgId, "COHORT") };
    });
    expect(r.pendingStatus).toBe("PENDING");
    expect(r.droppedRow?.status).toBe("DROPPED");
    expect(r.batch).toBe("ANCHORED");
    expect(r.head.epoch).toBe(1n);
  });
});

describe("issuer-key governance on a real chain (D46)", () => {
  it("a hand-made mirror row, even with a finalised-looking transaction, cannot sign: the chain never authorised that wallet", async () => {
    const e = env();
    const err = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const rogue = new Wallet(Wallet.createRandom().privateKey, e.provider);
      // A mirror row + a FINALIZED transaction row fabricated in the database; nothing on the chain.
      await addKey(tx, o.org.id, rogue);
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      return caught(signOnChain(tx, o, f, undefined, rogue));
    });
    expect(err).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/chain does not show/) });
  });

  it("retirement: the old wallet signs nothing new and cannot anchor, yet earlier evidence stays valid; rotation continues with a fresh wallet", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f1 = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const { now: signedAt } = await signOnChain(tx, o, f1);
      const issuedAt1 = (await tx.credential.findUniqueOrThrow({ where: { id: f1.credentialRowId } })).issuedAt!;

      const fresh = new Wallet(Wallet.createRandom().privateKey, e.provider);
      await fund(fresh.address);
      await mine(1);
      const rot = await buildSendRecord(tx, o.admin, e.adminWallet, "RETIRE_ISSUER_KEY", o.key.id, { newWallet: fresh.address });
      await finalise(tx, rot.rec.id);
      const oldKey = await tx.issuerKey.findUniqueOrThrow({ where: { id: o.key.id } });
      const newKey = await tx.issuerKey.findUniqueOrThrow({ where: { walletAddress: fresh.address.toLowerCase() }, include: { authoriseTransaction: true } });

      const f2 = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const clock = await signingClock(30);
      const oldSigns = await caught(signOnChain(tx, o, f2, clock, o.wallet));
      const newSigns = await signOnChain(tx, o, f2, clock, fresh);

      // On-chain the retired wallet can no longer anchor...
      const sealed = await sealCohortBatch(tx, o.issuer, { now: clock });
      const built = await buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, o.issuer, "ANCHOR_COHORT", sealed.batchId, {}, { now: clock });
      const retiredAnchor = await caught(o.wallet.sendTransaction({ to: built.to, data: built.data }));
      return {
        oldKey,
        newKey,
        oldSigns,
        newSigns,
        retiredAnchor: revertName(retiredAnchor),
        historical: await e.reader.isIssuerAuthorisedAt(o.org.orgId, o.wallet.address, BigInt(Math.floor(issuedAt1.getTime() / 1000))),
        now: await e.reader.isIssuerAuthorisedAt(o.org.orgId, o.wallet.address, BigInt((await chainNowSeconds()) + 100)),
        signedAt,
        c1: (await tx.credential.findUniqueOrThrow({ where: { id: f1.credentialRowId } })).pipelineStatus,
      };
    });
    expect(r.oldKey.validUntil).not.toBeNull();
    expect(r.newKey.authoriseTransaction?.status).toBe("FINALIZED");
    expect(r.newKey.validUntil).toBeNull();
    expect(r.oldSigns).toMatchObject({ code: "FORBIDDEN" });
    expect(r.newSigns.accepted.pipelineStatus).toBe("QUEUED_FOR_ANCHOR");
    expect(r.retiredAnchor).toBe("NotOpenIssuerOf");
    expect(r.historical).toBe(true); // signed while authorised: still valid
    expect(r.now).toBe(false);
    expect(r.c1).toBe("QUEUED_FOR_ANCHOR"); // evidence is retained
  });

  it("compromise closes the wallet, is mirrored additively, and the old wallet can never be authorised again", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      await mine(1);
      const at = BigInt(await chainNowSeconds());
      const comp = await buildSendRecord(tx, o.admin, e.adminWallet, "MARK_ISSUER_KEY_COMPROMISED", o.key.id, { compromisedAt: at }, new Date((Number(at) + 5) * 1000));
      await finalise(tx, comp.rec.id);
      const key = await tx.issuerKey.findUniqueOrThrow({ where: { id: o.key.id } });
      const reauth = await caught(buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, o.admin, "AUTHORISE_ISSUER_KEY", o.org.id, { wallet: o.wallet.address }, { now: new Date() }));
      // the chain also refuses it, even if built by hand
      const raw = await caught(e.adminWallet.sendTransaction({ to: e.cfg.registry, data: registryInterface.encodeFunctionData("authoriseIssuerWallet", [o.org.orgId, o.wallet.address]) }));
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      return { key, at, reauth, raw: revertName(raw), signs: await caught(signOnChain(tx, o, f)), chainKey: await e.registry.getIssuerKey(o.wallet.address) };
    });
    expect(r.key.compromisedAt?.getTime()).toBe(Number(r.at) * 1000);
    expect(r.key.validUntil).not.toBeNull();
    expect(r.chainKey.compromisedAt).toBe(r.at);
    expect(r.reauth).toMatchObject({ code: "CONFLICT" });
    expect(r.raw).toBe("WalletAlreadyKnown");
    expect(r.signs).toMatchObject({ code: "FORBIDDEN" });
  });
});

