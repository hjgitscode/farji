import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { metadataHashOf, registryInterface } from "@/lib/blockchain/registry";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { credentialIdOf } from "@/lib/crypto/commitments";
import { SCHEMA_ID, ZERO_HASH } from "@/lib/crypto/constants";
import type { LogLike } from "@/lib/blockchain/registry";
import type { TxPurpose, TxTargetType } from "@/lib/database/generated/client";
import type { ChainConfig, Finality } from "@/server/chain/config";
import { rescanRange, syncPending, syncTransaction } from "@/server/chain/sync";
import { sealCohortBatch } from "@/server/merkle/cohort";
import { freshWallet } from "../fixtures/test-wallets";
import { FakeRpc, REGISTRY, eventLog, hex32 } from "../fixtures/fake-rpc";
import { db, inRollback, mkOrg, mkUser, type Tx } from "./helpers";
import { addKey, approvedCredential, CONTINUING, issuerOf, PERMANENT, signCredential, type Fixture } from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const NOW = new Date("2026-10-21T10:00:00Z");
const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

const cfgOf = (finality: Finality = { mode: "depth", depth: 2 }): ChainConfig => ({ rpcUrl: "http://fake", chainId: 31337n, registry: REGISTRY, finality });
const envOf = (rpc: FakeRpc, finality?: Finality) => ({ cfg: cfgOf(finality), rpc });

const adminActor = async (tx: Tx): Promise<Actor> => ({
  userId: (await mkUser(tx, "ADMIN")).id,
  authUserId: randomUUID(),
  role: "ADMIN",
  organisationId: null,
  organisationStatus: null,
  memberId: null,
});

/** A recorded (PENDING) chain transaction known to the fake node. */
async function chainTx(
  tx: Tx,
  rpc: FakeRpc,
  o: { purpose: TxPurpose; targetType: TxTargetType; targetId: string; organisationId: string | null; initiator: string; from?: string; nonce?: number; mineAt?: number; logs?: LogLike[]; status?: number; seq?: number },
) {
  const from = (o.from ?? "0x" + "ab".repeat(20)).toLowerCase();
  const nonce = o.nonce ?? 0;
  const t = rpc.addTx({ from, nonce, data: "0x" });
  if (o.mineAt !== undefined) rpc.mine(t.hash, o.mineAt, o.logs ?? [], o.status ?? 1);
  const row = await tx.blockchainTransaction.create({
    data: {
      chainId: 31337,
      txHash: t.hash.toLowerCase(),
      purpose: o.purpose,
      targetType: o.targetType,
      targetId: o.targetId,
      targetSequence: o.seq ?? null,
      fromAddress: from,
      initiatedByUserId: o.initiator,
      organisationId: o.organisationId,
      txNonce: BigInt(nonce),
    },
  });
  return { row, hash: t.hash.toLowerCase() };
}

const statusOf = async (tx: Tx, id: string) => (await tx.blockchainTransaction.findUniqueOrThrow({ where: { id } })).status;

// ───────────────────────────── state machine ─────────────────────────────

describe("BlockchainTransaction state machine", () => {
  async function setup(tx: Tx) {
    const admin = await adminActor(tx);
    const org = await mkOrg(tx, "PENDING_ONBOARDING");
    return { admin, org };
  }
  const registerArgs = (orgId: string, slug = "x") => ({ orgId, metadataHash: metadataHashOf(slug) });

  it("a receipt moves PENDING to CONFIRMED (mined, tracking only) and stores the block; it is not final yet", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      rpc.latest = 91; // depth 2: block 90 is not final
      const { row, hash } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      const result = await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return { result, row: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id } }), org: await tx.organisation.findUniqueOrThrow({ where: { id: org.id } }), hash };
    });
    expect(r.result).toMatchObject({ status: "CONFIRMED", changed: true });
    expect(r.row).toMatchObject({ status: "CONFIRMED", blockNumber: 90n, finalizedAt: null });
    expect(r.row.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.row.confirmedAt?.toISOString()).toBe(NOW.toISOString());
    // CONFIRMED alone creates NO positive evidence: the organisation is still not ACTIVE.
    expect(r.org.status).toBe("PENDING_ONBOARDING");
  });

  it("at the configured depth it becomes FINALIZED and ONLY THEN is the organisation mirrored ACTIVE", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      rpc.latest = 91;
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      const beforeFinal = (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status;
      rpc.latest = 92;
      const result = await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return { beforeFinal, result, row: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id } }), after: (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status };
    });
    expect(r.beforeFinal).toBe("PENDING_ONBOARDING");
    expect(r.result.status).toBe("FINALIZED");
    expect(r.row.finalizedAt?.toISOString()).toBe(NOW.toISOString());
    expect(r.after).toBe("ACTIVE");
  });

  it("depth:0 (local development) finalises as soon as it is mined, in one sync pass", async () => {
    const status = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      rpc.latest = 90;
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      await syncTransaction(tx, envOf(rpc, { mode: "depth", depth: 0 }), row.id, { now: NOW });
      return statusOf(tx, row.id);
    });
    expect(status).toBe("FINALIZED");
  });

  it("with the Ethereum 'finalized' tag, finality follows the finalized block, not the head", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      rpc.latest = 200;
      rpc.finalized = 80; // block 90 is mined but not finalized
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      const finalizedMode: Finality = { mode: "finalized" };
      await syncTransaction(tx, envOf(rpc, finalizedMode), row.id, { now: NOW });
      const mid = await statusOf(tx, row.id);
      rpc.finalized = 90;
      await syncTransaction(tx, envOf(rpc, finalizedMode), row.id, { now: NOW });
      return { mid, end: await statusOf(tx, row.id) };
    });
    expect(r).toEqual({ mid: "CONFIRMED", end: "FINALIZED" });
  });

  it("a reverted receipt makes it FAILED (terminal) and mirrors nothing", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, status: 0, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      const first = await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      const again = await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return { first, again, row: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id } }), org: (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status };
    });
    expect(r.first.status).toBe("FAILED");
    expect(r.again.changed).toBe(false);
    expect(r.row.failureReason).toMatch(/reverted/);
    expect(r.row.blockNumber).toBeNull();
    expect(r.org).toBe("PENDING_ONBOARDING");
  });

  it("a transaction still in the mempool stays PENDING", async () => {
    const status = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId });
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return statusOf(tx, row.id);
    });
    expect(status).toBe("PENDING");
  });

  it("a replaced transaction (unknown hash, sender nonce consumed) becomes DROPPED", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      const from = "0x" + "cd".repeat(20);
      const { row, hash } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, from, nonce: 7 });
      rpc.txs.delete(hash); // vanished from the mempool
      rpc.nonces.set(from, 7); // nonce 7 is NOT yet consumed (count == 7)
      const soon = new Date(); // within the grace period: only the consumed nonce can drop it
      const stillPending = (await syncTransaction(tx, envOf(rpc), row.id, { now: soon })).status;
      rpc.nonces.set(from, 8); // another transaction used nonce 7
      const result = await syncTransaction(tx, envOf(rpc), row.id, { now: soon });
      return { stillPending, result, row: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id } }) };
    });
    expect(r.stillPending).toBe("PENDING");
    expect(r.result.status).toBe("DROPPED");
    expect(r.row.failureReason).toMatch(/replaced/);
  });

  it("an unknown transaction with no consumed nonce is given up only after the grace period", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      const { row, hash } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId });
      rpc.txs.delete(hash);
      const soon = (await syncTransaction(tx, envOf(rpc), row.id, { now: new Date(Date.now() + 3600_000) })).status;
      const late = (await syncTransaction(tx, envOf(rpc), row.id, { now: new Date(Date.now() + 25 * 3600_000) })).status;
      return { soon, late };
    });
    expect(r).toEqual({ soon: "PENDING", late: "DROPPED" });
  });

  it("a reorg sends a CONFIRMED transaction back to PENDING (block data cleared, nothing mirrored); it can confirm again elsewhere", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      rpc.latest = 91;
      const { row, hash } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      const confirmed = await statusOf(tx, row.id);
      rpc.reorgAway(hash);
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      const afterReorg = await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id } });
      // re-included in a different block; with the head far enough ahead it confirms and finalises
      rpc.latest = 120;
      rpc.txs.set(hash, { hash, from: row.fromAddress, to: REGISTRY, data: "0x", chainId: 31337n, nonce: 0 });
      rpc.mine(hash, 95, [eventLog("OrganisationRegistered", registerArgs(org.orgId))]);
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return { confirmed, afterReorg, final: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id } }), org: (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status };
    });
    expect(r.confirmed).toBe("CONFIRMED");
    expect(r.afterReorg).toMatchObject({ status: "PENDING", blockNumber: null, blockHash: null, confirmedAt: null });
    expect(r.final).toMatchObject({ status: "FINALIZED", blockNumber: 95n });
    expect(r.org).toBe("ACTIVE");
  });

  it("if the block hash changes between mining and finality the transaction goes back to PENDING instead of finalising", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      rpc.latest = 91;
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      rpc.blocks.set(90, { number: 90, hash: "0x" + "ff".repeat(32), timestamp: 1 }); // canonical block 90 is now another block
      rpc.latest = 200;
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return { status: await statusOf(tx, row.id), org: (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status };
    });
    expect(r).toEqual({ status: "PENDING", org: "PENDING_ONBOARDING" });
  });

  it("syncing a finalised transaction again is a no-op (duplicate sync prevented)", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      const before = await tx.auditEvent.count({ where: { targetId: row.id, action: "CHAIN_TX_FINALIZED" } });
      const again = await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      const sweep = await syncPending(tx, envOf(rpc), { now: NOW });
      return { before, again, sweep: sweep.filter((s) => s.id === row.id), after: await tx.auditEvent.count({ where: { targetId: row.id, action: "CHAIN_TX_FINALIZED" } }) };
    });
    expect(r.before).toBe(1);
    expect(r.again.changed).toBe(false);
    expect(r.sweep).toEqual([]); // terminal rows are not even picked up
    expect(r.after).toBe(1);
  });

  it("an RPC failure during a sweep leaves the row as it was and reports its real status (Phase 16)", async () => {
    const r = await inRollback(async (tx) => {
      const { admin, org } = await setup(tx);
      const rpc = new FakeRpc();
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
      rpc.getTransactionReceipt = async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1:8545");
      };
      const sweep = (await syncPending(tx, envOf(rpc), { now: NOW })).filter((s) => s.id === row.id);
      return { sweep, stored: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } }) };
    });
    expect(r.stored.status).toBe("PENDING");
    expect(r.sweep).toHaveLength(1);
    expect(r.sweep[0]).toMatchObject({ status: "PENDING", changed: false });
    expect(r.sweep[0].error).toBeTruthy();
  });

  it("txNonce is immutable and the status of a FINALIZED transaction can never change", async () => {
    await expect(
      inRollback(async (tx) => {
        const { admin, org } = await setup(tx);
        const rpc = new FakeRpc();
        const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, nonce: 3 });
        await tx.blockchainTransaction.update({ where: { id: row.id }, data: { txNonce: 4n } });
      }),
    ).rejects.toThrow(/immutable/);

    await expect(
      inRollback(async (tx) => {
        const { admin, org } = await setup(tx);
        const rpc = new FakeRpc();
        const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationRegistered", registerArgs(org.orgId))] });
        await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
        await tx.blockchainTransaction.update({ where: { id: row.id }, data: { status: "PENDING" } });
      }),
    ).rejects.toThrow(/terminal/);
  });

  it("txNonce must be non-negative", async () => {
    await expect(
      inRollback(async (tx) => {
        const { admin, org } = await setup(tx);
        await tx.blockchainTransaction.create({
          data: { chainId: 31337, txHash: hex32(), purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, fromAddress: "0x" + "ab".repeat(20), initiatedByUserId: admin.userId, txNonce: -1n },
        });
      }),
    ).rejects.toThrow();
  });
});

// ───────────────────────────── mirror: organisation and issuer keys ─────────────────────────────

describe("finalised evidence: organisation and issuer-key mirrors", () => {
  it("status changes mirror the organisation; unknown organisations only reach the audit trail", async () => {
    const r = await inRollback(async (tx) => {
      const admin = await adminActor(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const rpc = new FakeRpc();
      const status = await chainTx(tx, rpc, { purpose: "SET_ORGANISATION_STATUS", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("OrganisationStatusChanged", { orgId: org.orgId, status: 2 })] });
      await syncTransaction(tx, envOf(rpc), status.row.id, { now: NOW });
      const ghost = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, nonce: 1, mineAt: 91, logs: [eventLog("OrganisationRegistered", { orgId: hex32(), metadataHash: hex32() })] });
      await syncTransaction(tx, envOf(rpc), ghost.row.id, { now: NOW });
      return { org: (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status, unmatched: await tx.auditEvent.count({ where: { action: "CHAIN_EVENT_UNMATCHED", targetId: ghost.row.id } }), ghostStatus: await statusOf(tx, ghost.row.id) };
    });
    expect(r).toEqual({ org: "SUSPENDED", unmatched: 1, ghostStatus: "FINALIZED" });
  });

  it("IssuerKey rows appear only at FINALIZED, linked to their authorisation transaction, and follow retirement and compromise", async () => {
    const r = await inRollback(async (tx) => {
      const admin = await adminActor(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const wallet = freshWallet().address.toLowerCase();
      const rpc = new FakeRpc();
      rpc.latest = 91; // not final yet
      const auth = await chainTx(tx, rpc, { purpose: "AUTHORISE_ISSUER_KEY", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("IssuerWalletAuthorised", { orgId: org.orgId, wallet, validFrom: 1_760_000_000n })] });
      await syncTransaction(tx, envOf(rpc), auth.row.id, { now: NOW });
      const early = await tx.issuerKey.count({ where: { walletAddress: wallet } });
      rpc.latest = 100;
      await syncTransaction(tx, envOf(rpc), auth.row.id, { now: NOW });
      const key = await tx.issuerKey.findUniqueOrThrow({ where: { walletAddress: wallet } });

      const retire = await chainTx(tx, rpc, { purpose: "RETIRE_ISSUER_KEY", targetType: "ISSUER_KEY", targetId: key.id, organisationId: org.id, initiator: admin.userId, nonce: 1, mineAt: 91, logs: [eventLog("IssuerWalletRetired", { orgId: org.orgId, wallet, validUntil: 1_760_100_000n })] });
      await syncTransaction(tx, envOf(rpc), retire.row.id, { now: NOW });
      const comp = await chainTx(tx, rpc, { purpose: "MARK_ISSUER_KEY_COMPROMISED", targetType: "ISSUER_KEY", targetId: key.id, organisationId: org.id, initiator: admin.userId, nonce: 2, mineAt: 92, logs: [eventLog("IssuerWalletCompromised", { orgId: org.orgId, wallet, compromisedAt: 1_760_050_000n, validUntil: 1_760_200_000n })] });
      await syncTransaction(tx, envOf(rpc), comp.row.id, { now: NOW });
      return { early, auth, key, after: await tx.issuerKey.findUniqueOrThrow({ where: { id: key.id } }), retireId: retire.row.id };
    });
    expect(r.early).toBe(0); // CONFIRMED only: no authority yet
    expect(r.key).toMatchObject({ organisationId: expect.any(String), authoriseTransactionId: r.auth.row.id });
    expect(r.key.validFrom.getTime()).toBe(1_760_000_000_000);
    // retirement keeps validFrom; the compromise marker is added; validUntil stays the FIRST closing (write-once)
    expect(r.after.validUntil?.getTime()).toBe(1_760_100_000_000);
    expect(r.after.compromisedAt?.getTime()).toBe(1_760_050_000_000);
    expect(r.after.retireTransactionId).toBe(r.retireId);
  });

  it("a replayed authorisation never creates a second key or re-binds a wallet to another organisation", async () => {
    const r = await inRollback(async (tx) => {
      const admin = await adminActor(tx);
      const a = await mkOrg(tx, "ACTIVE");
      const b = await mkOrg(tx, "ACTIVE");
      const wallet = freshWallet().address.toLowerCase();
      const rpc = new FakeRpc();
      const first = await chainTx(tx, rpc, { purpose: "AUTHORISE_ISSUER_KEY", targetType: "ORGANISATION", targetId: a.id, organisationId: a.id, initiator: admin.userId, mineAt: 90, logs: [eventLog("IssuerWalletAuthorised", { orgId: a.orgId, wallet, validFrom: 1_760_000_000n })] });
      await syncTransaction(tx, envOf(rpc), first.row.id, { now: NOW });
      const second = await chainTx(tx, rpc, { purpose: "AUTHORISE_ISSUER_KEY", targetType: "ORGANISATION", targetId: b.id, organisationId: b.id, initiator: admin.userId, nonce: 1, mineAt: 91, logs: [eventLog("IssuerWalletAuthorised", { orgId: b.orgId, wallet, validFrom: 1_760_000_500n })] });
      await syncTransaction(tx, envOf(rpc), second.row.id, { now: NOW });
      return { keys: await tx.issuerKey.findMany({ where: { walletAddress: wallet } }), a, unmatched: await tx.auditEvent.count({ where: { action: "CHAIN_EVENT_UNMATCHED", targetId: second.row.id } }) };
    });
    expect(r.keys).toHaveLength(1);
    expect(r.keys[0].organisationId).toBe(r.a.id);
    expect(r.unmatched).toBe(1);
  });

  it("only logs emitted by the configured registry are mirrored", async () => {
    const r = await inRollback(async (tx) => {
      const admin = await adminActor(tx);
      const org = await mkOrg(tx, "PENDING_ONBOARDING");
      const rpc = new FakeRpc();
      const forged = eventLog("OrganisationRegistered", { orgId: org.orgId, metadataHash: hex32() }, "0x" + "de".repeat(20)); // another contract
      const { row } = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, mineAt: 90, logs: [forged] });
      await syncTransaction(tx, envOf(rpc), row.id, { now: NOW });
      return { status: await statusOf(tx, row.id), org: (await tx.organisation.findUniqueOrThrow({ where: { id: org.id } })).status };
    });
    expect(r).toEqual({ status: "FINALIZED", org: "PENDING_ONBOARDING" });
  });
});

// ───────────────────────────── mirror: anchors, revocations ─────────────────────────────

describe("finalised evidence: anchors, ANCHORED and revocations", () => {
  async function issuerWithKey(tx: Tx) {
    const org = await mkOrg(tx, "ACTIVE");
    const issuer = await issuerOf(tx, org.id);
    const wallet = freshWallet();
    await addKey(tx, org.id, wallet);
    return { org, issuer, wallet };
  }
  const cohortEvent = (orgOnChain: string, wallet: string, root: string, leafCount: number, epoch = 1n, previous = ZERO_HASH, chainRoot?: string) =>
    eventLog("CohortRootAnchored", {
      orgId: orgOnChain,
      chainRoot: chainRoot ?? chainRootOf(root, previous, orgOnChain, "COHORT", epoch),
      epoch,
      batchRoot: root,
      previousChainRoot: previous,
      leafCount,
      schemaId: SCHEMA_ID,
      anchoredBy: wallet,
    });

  async function sealedBatch(tx: Tx, ctx: Awaited<ReturnType<typeof issuerWithKey>>, n = 2) {
    const fs: Fixture[] = [];
    for (let i = 0; i < n; i++) {
      const f = await approvedCredential(tx, PERMANENT, { orgId: ctx.org.id, issuer: ctx.issuer });
      await signCredential(tx, f, ctx.wallet, { enqueue: true });
      fs.push(f);
    }
    const sealed = await sealCohortBatch(tx, ctx.issuer, { now: NOW });
    return { fs, sealed };
  }

  it("a finalised COHORT anchor creates the Anchor, anchors the batch and moves its credentials to ANCHORED - never before finality", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const { fs, sealed } = await sealedBatch(tx, ctx);
      const rpc = new FakeRpc();
      rpc.latest = 91;
      const t = await chainTx(tx, rpc, {
        purpose: "ANCHOR_COHORT",
        targetType: "COHORT_BATCH",
        targetId: sealed.batchId,
        organisationId: ctx.org.id,
        initiator: ctx.issuer.userId,
        from: ctx.wallet.address,
        mineAt: 90,
        logs: [cohortEvent(ctx.org.orgId, ctx.wallet.address.toLowerCase(), sealed.batchRoot, sealed.leafCount)],
      });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      const early = {
        anchors: await tx.anchor.count({ where: { organisationId: ctx.org.id } }),
        batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status,
        creds: await tx.credential.findMany({ where: { id: { in: fs.map((f) => f.credentialRowId) } }, select: { pipelineStatus: true } }),
      };
      rpc.latest = 100;
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      const anchor = await tx.anchor.findFirstOrThrow({ where: { organisationId: ctx.org.id } });
      return {
        ctx,
        sealed,
        t,
        early,
        anchor,
        batch: await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } }),
        creds: await tx.credential.findMany({ where: { id: { in: fs.map((f) => f.credentialRowId) } }, select: { pipelineStatus: true } }),
      };
    });
    expect(r.early.anchors).toBe(0);
    expect(r.early.batch).toBe("SEALED");
    expect(r.early.creds.every((c) => c.pipelineStatus === "QUEUED_FOR_ANCHOR")).toBe(true);

    expect(r.anchor).toMatchObject({ attestationType: "COHORT", epoch: 1, batchRoot: r.sealed.batchRoot, previousChainRoot: ZERO_HASH, leafCount: 2, rootSeq: null, transactionId: r.t.row.id });
    expect(r.anchor.chainRoot).toBe(chainRootOf(r.sealed.batchRoot, ZERO_HASH, r.ctx.org.orgId, "COHORT", 1n));
    expect(r.anchor.blockNumber).toBe(90n);
    expect(r.batch).toMatchObject({ status: "ANCHORED", anchorId: r.anchor.id });
    expect(r.creds.every((c) => c.pipelineStatus === "ANCHORED")).toBe(true);
  });

  it("an anchor event in the wrong organisation or unknown batch root records the chain fact but transitions nothing", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const { fs, sealed } = await sealedBatch(tx, ctx, 1);
      const rpc = new FakeRpc();
      const t = await chainTx(tx, rpc, {
        purpose: "ANCHOR_COHORT",
        targetType: "COHORT_BATCH",
        targetId: sealed.batchId,
        organisationId: ctx.org.id,
        initiator: ctx.issuer.userId,
        from: ctx.wallet.address,
        mineAt: 90,
        logs: [cohortEvent(ctx.org.orgId, ctx.wallet.address.toLowerCase(), hex32(), 1)], // a root FARJI never sealed
      });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      return {
        anchors: await tx.anchor.count({ where: { organisationId: ctx.org.id } }),
        batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status,
        cred: (await tx.credential.findUniqueOrThrow({ where: { id: fs[0].credentialRowId } })).pipelineStatus,
      };
    });
    expect(r).toEqual({ anchors: 1, batch: "SEALED", cred: "QUEUED_FOR_ANCHOR" });
  });

  it("a chainRoot that disagrees with the TypeScript formula is refused: nothing is mirrored", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const { sealed } = await sealedBatch(tx, ctx, 1);
      const rpc = new FakeRpc();
      const t = await chainTx(tx, rpc, {
        purpose: "ANCHOR_COHORT",
        targetType: "COHORT_BATCH",
        targetId: sealed.batchId,
        organisationId: ctx.org.id,
        initiator: ctx.issuer.userId,
        from: ctx.wallet.address,
        mineAt: 90,
        logs: [cohortEvent(ctx.org.orgId, ctx.wallet.address.toLowerCase(), sealed.batchRoot, sealed.leafCount, 1n, ZERO_HASH, hex32())],
      });
      const err = await caught(syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW }));
      return { err: (err as Error).message, anchors: await tx.anchor.count({ where: { organisationId: ctx.org.id } }), batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status };
    });
    expect(r.err).toMatch(/chainRoot/);
    expect(r.anchors).toBe(0);
    expect(r.batch).toBe("SEALED");
  });

  it("an anchor by a wallet that was never mirrored waits (stays unfinished) instead of guessing", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const { sealed } = await sealedBatch(tx, ctx, 1);
      const rpc = new FakeRpc();
      const stranger = freshWallet().address.toLowerCase();
      const t = await chainTx(tx, rpc, { purpose: "ANCHOR_COHORT", targetType: "COHORT_BATCH", targetId: sealed.batchId, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: stranger, mineAt: 90, logs: [cohortEvent(ctx.org.orgId, stranger, sealed.batchRoot, sealed.leafCount)] });
      const err = await caught(syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW }));
      return { err: (err as Error).message, anchors: await tx.anchor.count({ where: { organisationId: ctx.org.id } }) };
    });
    expect(r.err).toMatch(/not been mirrored/);
    expect(r.anchors).toBe(0);
  });

  it("a finalised PROOF_PULSE anchor covers exactly the leaves inserted at or before its rootSeq", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const f1 = await approvedCredential(tx, CONTINUING, { orgId: ctx.org.id, issuer: ctx.issuer });
      await signCredential(tx, f1, ctx.wallet);
      const f2 = await approvedCredential(tx, CONTINUING, { orgId: ctx.org.id, issuer: ctx.issuer });
      await signCredential(tx, f2, ctx.wallet);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.org.id } });
      const updates = await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } });
      const rpc = new FakeRpc();
      const pulseEvent = (seq: number, leafCount: number, previous: string, epoch: bigint) =>
        eventLog("ProofPulseEpochAnchored", {
          orgId: ctx.org.orgId,
          chainRoot: chainRootOf(updates[seq - 1].newRoot, previous, ctx.org.orgId, "PROOF_PULSE", epoch),
          epoch,
          batchRoot: updates[seq - 1].newRoot,
          previousChainRoot: previous,
          rootSeq: BigInt(seq),
          leafCount,
          anchoredBy: ctx.wallet.address.toLowerCase(),
        });
      // epoch 1 snapshots the root after the FIRST leaf only (rootSeq 1)
      const e1 = await chainTx(tx, rpc, { purpose: "ANCHOR_PROOF_PULSE", targetType: "PROOF_PULSE_TREE", targetId: tree.id, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: ctx.wallet.address, seq: 1, mineAt: 90, logs: [pulseEvent(1, 1, ZERO_HASH, 1n)] });
      await syncTransaction(tx, envOf(rpc), e1.row.id, { now: NOW });
      const mid = {
        c1: (await tx.credential.findUniqueOrThrow({ where: { id: f1.credentialRowId } })).pipelineStatus,
        c2: (await tx.credential.findUniqueOrThrow({ where: { id: f2.credentialRowId } })).pipelineStatus,
      };
      const first = await tx.anchor.findFirstOrThrow({ where: { organisationId: ctx.org.id, attestationType: "PROOF_PULSE" } });
      const e2 = await chainTx(tx, rpc, { purpose: "ANCHOR_PROOF_PULSE", targetType: "PROOF_PULSE_TREE", targetId: tree.id, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: ctx.wallet.address, nonce: 1, seq: 2, mineAt: 91, logs: [pulseEvent(2, 2, first.chainRoot, 2n)] });
      await syncTransaction(tx, envOf(rpc), e2.row.id, { now: NOW });
      return {
        mid,
        first,
        anchors: await tx.anchor.findMany({ where: { organisationId: ctx.org.id, attestationType: "PROOF_PULSE" }, orderBy: { epoch: "asc" } }),
        end: {
          c1: (await tx.credential.findUniqueOrThrow({ where: { id: f1.credentialRowId } })).pipelineStatus,
          c2: (await tx.credential.findUniqueOrThrow({ where: { id: f2.credentialRowId } })).pipelineStatus,
        },
      };
    });
    expect(r.mid).toEqual({ c1: "ANCHORED", c2: "QUEUED_FOR_ANCHOR" });
    expect(r.anchors.map((a) => [a.epoch, a.rootSeq, a.leafCount])).toEqual([[1, 1, 1], [2, 2, 2]]);
    expect(r.anchors[1].previousChainRoot).toBe(r.first.chainRoot);
    expect(r.end).toEqual({ c1: "ANCHORED", c2: "ANCHORED" });
  });

  it("a PROOF_PULSE anchor whose root is not in FARJI's update log is recorded but anchors no credential", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const f = await approvedCredential(tx, CONTINUING, { orgId: ctx.org.id, issuer: ctx.issuer });
      await signCredential(tx, f, ctx.wallet);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.org.id } });
      const rpc = new FakeRpc();
      const root = hex32();
      const t = await chainTx(tx, rpc, {
        purpose: "ANCHOR_PROOF_PULSE",
        targetType: "PROOF_PULSE_TREE",
        targetId: tree.id,
        organisationId: ctx.org.id,
        initiator: ctx.issuer.userId,
        from: ctx.wallet.address,
        mineAt: 90,
        logs: [eventLog("ProofPulseEpochAnchored", { orgId: ctx.org.orgId, chainRoot: chainRootOf(root, ZERO_HASH, ctx.org.orgId, "PROOF_PULSE", 1n), epoch: 1n, batchRoot: root, previousChainRoot: ZERO_HASH, rootSeq: 1n, leafCount: 1, anchoredBy: ctx.wallet.address.toLowerCase() })],
      });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      return { anchors: await tx.anchor.count({ where: { organisationId: ctx.org.id } }), cred: (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).pipelineStatus };
    });
    expect(r).toEqual({ anchors: 1, cred: "QUEUED_FOR_ANCHOR" });
  });

  it("a finalised revocation creates the Revocation row for the issuing organisation's known credential only", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: ctx.org.id, issuer: ctx.issuer });
      await signCredential(tx, f, ctx.wallet, { enqueue: false });
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
      const rpc = new FakeRpc();
      rpc.latest = 91;
      const evt = eventLog("CredentialRevoked", { credentialId: cred.credentialId!, orgId: ctx.org.orgId, reasonCode: 2, revokedBy: ctx.wallet.address.toLowerCase(), credentialSalt: cred.credentialSalt! });
      const t = await chainTx(tx, rpc, { purpose: "REVOKE_CREDENTIAL", targetType: "CREDENTIAL", targetId: cred.id, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: ctx.wallet.address, mineAt: 90, logs: [evt] });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      const early = await tx.revocation.count({ where: { organisationId: ctx.org.id } });
      rpc.latest = 100;
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      return { early, cred, t, rev: await tx.revocation.findMany({ where: { organisationId: ctx.org.id } }), after: await tx.credential.findUniqueOrThrow({ where: { id: cred.id } }) };
    });
    expect(r.early).toBe(0);
    expect(r.rev).toHaveLength(1);
    expect(r.rev[0]).toMatchObject({ credentialRowId: r.cred.id, reasonCode: "FRAUD", transactionId: r.t.row.id, blockNumber: 90n });
    // Revocation is evidence: the Credential is untouched (not deleted, not re-statused).
    expect(r.after).toEqual(r.cred);
  });

  it("cross-organisation protection: a revocation event for another organisation's namespace never marks this organisation's credential", async () => {
    const r = await inRollback(async (tx) => {
      const a = await issuerWithKey(tx);
      const b = await issuerWithKey(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: a.org.id, issuer: a.issuer });
      await signCredential(tx, f, a.wallet, { enqueue: false });
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
      const before = await tx.revocation.count({});
      const rpc = new FakeRpc();
      // B's wallet "revokes" with A's salt: the contract derives a DIFFERENT id in B's namespace.
      const idInB = credentialIdOf(b.org.orgId, cred.credentialSalt!);
      const evt = eventLog("CredentialRevoked", { credentialId: idInB, orgId: b.org.orgId, reasonCode: 1, revokedBy: b.wallet.address.toLowerCase(), credentialSalt: cred.credentialSalt! });
      const t = await chainTx(tx, rpc, { purpose: "REVOKE_CREDENTIAL", targetType: "CREDENTIAL", targetId: cred.id, organisationId: b.org.id, initiator: b.issuer.userId, from: b.wallet.address, mineAt: 90, logs: [evt] });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      return { delta: (await tx.revocation.count({})) - before, unmatched: await tx.auditEvent.count({ where: { action: "CHAIN_EVENT_UNMATCHED", targetId: t.row.id } }), credA: (await tx.credential.findUniqueOrThrow({ where: { id: cred.id }, include: { revocation: true } })).revocation };
    });
    expect(r.unmatched).toBe(1);
    expect(r.delta).toBe(0); // nothing revoked anywhere
    expect(r.credA).toBeNull(); // A's credential is untouched
  });

  it("an event whose credentialId does not match orgId + salt is refused", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: ctx.org.id, issuer: ctx.issuer });
      await signCredential(tx, f, ctx.wallet, { enqueue: false });
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
      const rpc = new FakeRpc();
      const evt = eventLog("CredentialRevoked", { credentialId: cred.credentialId!, orgId: ctx.org.orgId, reasonCode: 1, revokedBy: ctx.wallet.address.toLowerCase(), credentialSalt: hex32() });
      const t = await chainTx(tx, rpc, { purpose: "REVOKE_CREDENTIAL", targetType: "CREDENTIAL", targetId: cred.id, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: ctx.wallet.address, mineAt: 90, logs: [evt] });
      const err = await caught(syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW }));
      return { err: (err as Error).message, revocations: await tx.revocation.count({ where: { organisationId: ctx.org.id } }) };
    });
    expect(r.err).toMatch(/does not match/);
    expect(r.revocations).toBe(0);
  });

  it("an unknown credential in the organisation's namespace is a chain fact only (audit), not a Revocation row", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const salt = hex32();
      const rpc = new FakeRpc();
      const evt = eventLog("CredentialRevoked", { credentialId: credentialIdOf(ctx.org.orgId, salt), orgId: ctx.org.orgId, reasonCode: 4, revokedBy: ctx.wallet.address.toLowerCase(), credentialSalt: salt });
      const t = await chainTx(tx, rpc, { purpose: "REVOKE_CREDENTIAL", targetType: "CREDENTIAL", targetId: ctx.org.id, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: ctx.wallet.address, mineAt: 90, logs: [evt] });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      return { revocations: await tx.revocation.count({ where: { organisationId: ctx.org.id } }), unmatched: await tx.auditEvent.count({ where: { action: "CHAIN_EVENT_UNMATCHED", targetId: t.row.id } }) };
    });
    expect(r).toEqual({ revocations: 0, unmatched: 1 });
  });

  it("an anchor event inside a transaction of another purpose is not mirrored", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await issuerWithKey(tx);
      const { sealed } = await sealedBatch(tx, ctx, 1);
      const rpc = new FakeRpc();
      const t = await chainTx(tx, rpc, { purpose: "REVOKE_CREDENTIAL", targetType: "CREDENTIAL", targetId: ctx.org.id, organisationId: ctx.org.id, initiator: ctx.issuer.userId, from: ctx.wallet.address, mineAt: 90, logs: [cohortEvent(ctx.org.orgId, ctx.wallet.address.toLowerCase(), sealed.batchRoot, sealed.leafCount)] });
      await syncTransaction(tx, envOf(rpc), t.row.id, { now: NOW });
      return { anchors: await tx.anchor.count({ where: { organisationId: ctx.org.id } }), batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status };
    });
    expect(r).toEqual({ anchors: 0, batch: "SEALED" });
  });

  it("Anchor, Revocation and IssuerKey rows cannot be created from a transaction that is not CONFIRMED/FINALIZED (database trigger)", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await issuerWithKey(tx);
        const { sealed } = await sealedBatch(tx, ctx, 1);
        const admin = await adminActor(tx);
        const pending = await tx.blockchainTransaction.create({
          data: { chainId: 31337, txHash: hex32(), purpose: "ANCHOR_COHORT", targetType: "COHORT_BATCH", targetId: sealed.batchId, fromAddress: "0x" + "ab".repeat(20), initiatedByUserId: admin.userId, organisationId: ctx.org.id },
        });
        const key = await tx.issuerKey.findFirstOrThrow({ where: { organisationId: ctx.org.id } });
        await tx.anchor.create({
          data: { organisationId: ctx.org.id, attestationType: "COHORT", epoch: 1, batchRoot: sealed.batchRoot, previousChainRoot: ZERO_HASH, chainRoot: hex32(), leafCount: 1, anchorerKeyId: key.id, transactionId: pending.id, blockNumber: 1n, blockTimestamp: NOW },
        });
      }),
    ).rejects.toThrow(/CONFIRMED or FINALIZED/);
  });
});

// ───────────────────────────── admin rescan ─────────────────────────────

describe("admin range rescan", () => {
  it("adopts a transaction that REPLACED a recorded one (same sender and nonce) and never guesses anything else", async () => {
    const r = await inRollback(async (tx) => {
      const admin = await adminActor(tx);
      const org = await mkOrg(tx, "PENDING_ONBOARDING");
      const rpc = new FakeRpc();
      const from = "0x" + "cd".repeat(20);
      const original = await chainTx(tx, rpc, { purpose: "REGISTER_ORGANISATION", targetType: "ORGANISATION", targetId: org.id, organisationId: org.id, initiator: admin.userId, from, nonce: 4 });
      rpc.txs.delete(original.hash);

      // The replacement and an unrelated registry transaction both appear in the logs.
      const replacement = rpc.addTx({ from, nonce: 4, data: registerData(org.orgId) });
      const stranger = rpc.addTx({ from: "0x" + "99".repeat(20), nonce: 0, data: registerData(hex32()) });
      rpc.logs = [
        { address: REGISTRY, topics: [], data: "0x", transactionHash: replacement.hash, blockNumber: 90 },
        { address: REGISTRY, topics: [], data: "0x", transactionHash: stranger.hash, blockNumber: 91 },
      ];
      const result = await rescanRange(tx, envOf(rpc), admin, { fromBlock: 80, toBlock: 100 });
      return { result, replacement, stranger, rows: await tx.blockchainTransaction.findMany({ where: { targetId: org.id }, orderBy: { submittedAt: "asc" } }), strangerKnown: await tx.blockchainTransaction.count({ where: { txHash: stranger.hash.toLowerCase() } }) };
    });
    expect(r.result).toMatchObject({ scanned: 2, adopted: 1, alreadyKnown: 0 });
    expect(r.result.unattributed).toEqual([r.stranger.hash.toLowerCase()]);
    expect(r.strangerKnown).toBe(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].status).toBe("DROPPED");
    expect(r.rows[1]).toMatchObject({ txHash: r.replacement.hash.toLowerCase(), purpose: "REGISTER_ORGANISATION", status: "PENDING", txNonce: 4n });
  });

  it("is admin-only and bounded", async () => {
    const r = await inRollback(async (tx) => {
      const admin = await adminActor(tx);
      const rpc = new FakeRpc();
      return {
        issuer: await caught(rescanRange(tx, envOf(rpc), { ...admin, role: "ISSUER" }, { fromBlock: 1, toBlock: 2 })),
        range: await caught(rescanRange(tx, envOf(rpc), admin, { fromBlock: 0, toBlock: 99999 })),
      };
    });
    expect(r.issuer).toMatchObject({ code: "FORBIDDEN" });
    expect(r.range).toMatchObject({ code: "VALIDATION" });
  });
});

function registerData(orgId: string) {
  return registryInterface.encodeFunctionData("registerOrganisation", [orgId, hex32()]);
}
