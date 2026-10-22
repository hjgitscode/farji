import { decodeRegistryCall } from "@/lib/blockchain/registry";
import type { TxStatus } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";
import { inTransaction, isUuid } from "@/server/issuance/common";
import { assertAdmin, type ChainDb } from "./actions";
import type { ChainContext } from "./context";
import type { Finality } from "./config";
import { mirrorFinalizedTransaction } from "./mirror";
import { ensureChainReady } from "./ready";
import { PENDING_GIVE_UP_MS } from "./policy";
import type { BlockTag, ChainRpc } from "./rpc";
import type { Actor } from "@/lib/auth/authorize";

// BlockchainTransaction state machine (ROADMAP decisions C/D, BLOCKCHAIN_MODEL §13):
//
//   PENDING   --receipt ok-->                  CONFIRMED    (mined: tracking only, never evidence)
//   PENDING   --receipt reverted-->            FAILED       (terminal)
//   PENDING   --unknown + nonce consumed-->    DROPPED      (replaced; terminal)
//   PENDING   --unknown for too long-->        DROPPED      (terminal)
//   CONFIRMED --receipt gone / other block-->  PENDING      (reorg)
//   CONFIRMED --final per the policy-->        FINALIZED    (+ mirror, in ONE database transaction)
//
// Only this module changes a transaction's status (server-side chain sync); the client never does.
// Every transition is a conditional update, so concurrent or repeated syncs are harmless.

export type SyncResult = {
  id: string;
  status: TxStatus;
  changed: boolean;
  error?: string;
};

type Env = Pick<ChainContext, "cfg" | "rpc">;

/** Has the block reached the configured finality? */
export async function isFinal(rpc: ChainRpc, finality: Finality, blockNumber: number): Promise<boolean> {
  if (finality.mode === "depth") {
    const latest = await rpc.getBlockNumber();
    return latest - blockNumber >= finality.depth;
  }
  const finalized = await rpc.getBlock("finalized");
  return finalized !== null && finalized.number >= blockNumber;
}

/** The block tag at which a sender nonce counts as consumed for good (the same finality notion). */
async function settledTag(rpc: ChainRpc, finality: Finality): Promise<BlockTag> {
  if (finality.mode === "finalized") return "finalized";
  return Math.max(0, (await rpc.getBlockNumber()) - finality.depth);
}

export async function syncTransaction(db: ChainDb, chain: Env, txId: string, opts: { now?: Date } = {}): Promise<SyncResult> {
  if (!isUuid(txId)) throw new DomainError("NOT_FOUND", "Transaction not found.");
  const now = opts.now ?? new Date();
  const first = await db.blockchainTransaction.findUnique({ where: { id: txId } });
  if (!first) throw new DomainError("NOT_FOUND", "Transaction not found.");
  // Never read a node that is not the configured network, or an address that holds no registry (Phase 15).
  await ensureChainReady(chain);

  let status = first.status;
  let changed = false;
  // PENDING -> CONFIRMED -> FINALIZED can happen in one pass when the chain is already final.
  for (let step = 0; step < 3; step++) {
    const row = await db.blockchainTransaction.findUniqueOrThrow({ where: { id: txId } });
    status = row.status;
    if (status === "FINALIZED" || status === "FAILED" || status === "DROPPED") break;
    const moved = status === "PENDING" ? await advancePending(db, chain, row, now) : await advanceConfirmed(db, chain, row, now);
    if (!moved) break;
    changed = true;
  }
  const latest = await db.blockchainTransaction.findUniqueOrThrow({ where: { id: txId }, select: { status: true } });
  return { id: txId, status: latest.status, changed };
}

type Row = Awaited<ReturnType<ChainDb["blockchainTransaction"]["findUniqueOrThrow"]>>;

async function advancePending(db: ChainDb, chain: Env, row: Row, now: Date): Promise<boolean> {
  const receipt = await chain.rpc.getTransactionReceipt(row.txHash);
  if (receipt) {
    if (receipt.status === 1) {
      const { count } = await db.blockchainTransaction.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "CONFIRMED", blockNumber: BigInt(receipt.blockNumber), blockHash: receipt.blockHash.toLowerCase(), confirmedAt: now },
      });
      return count === 1;
    }
    if (receipt.status === 0) {
      const { count } = await db.blockchainTransaction.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: `reverted in block ${receipt.blockNumber}` },
      });
      return count === 1;
    }
    return false;
  }

  if (await chain.rpc.getTransaction(row.txHash)) return false; // still in the mempool

  // Unknown to the node. Replaced if the sender's nonce has been consumed for good by another transaction.
  if (row.txNonce !== null) {
    const used = await chain.rpc.getTransactionCount(row.fromAddress, await settledTag(chain.rpc, chain.cfg.finality));
    if (BigInt(used) > row.txNonce) {
      return dropped(db, row.id, `replaced: nonce ${row.txNonce} was used by another transaction`);
    }
  }
  if (now.getTime() - row.submittedAt.getTime() > PENDING_GIVE_UP_MS) {
    return dropped(db, row.id, "not found on the node");
  }
  return false;
}

async function dropped(db: ChainDb, id: string, reason: string): Promise<boolean> {
  const { count } = await db.blockchainTransaction.updateMany({ where: { id, status: "PENDING" }, data: { status: "DROPPED", failureReason: reason } });
  return count === 1;
}

async function advanceConfirmed(db: ChainDb, chain: Env, row: Row, now: Date): Promise<boolean> {
  const receipt = await chain.rpc.getTransactionReceipt(row.txHash);
  const block = receipt && receipt.status === 1 ? await chain.rpc.getBlock(receipt.blockNumber) : null;
  const sameBlock =
    receipt !== null && receipt.status === 1 && row.blockHash !== null && receipt.blockHash.toLowerCase() === row.blockHash && block !== null && block.hash.toLowerCase() === row.blockHash;

  if (!receipt || !block || !sameBlock) {
    // REORG: the block it was mined in is no longer canonical. Back to PENDING; nothing was mirrored.
    const { count } = await db.blockchainTransaction.updateMany({
      where: { id: row.id, status: "CONFIRMED" },
      data: { status: "PENDING", blockNumber: null, blockHash: null, confirmedAt: null },
    });
    return count === 1;
  }
  if (!(await isFinal(chain.rpc, chain.cfg.finality, receipt.blockNumber))) return false;

  // FINALIZED and the mirror happen together or not at all.
  return inTransaction(db, async (tx) => {
    const { count } = await tx.blockchainTransaction.updateMany({
      where: { id: row.id, status: "CONFIRMED", blockHash: row.blockHash },
      data: { status: "FINALIZED", finalizedAt: now },
    });
    if (count !== 1) return false;
    await mirrorFinalizedTransaction(tx, { id: row.id, purpose: row.purpose, targetType: row.targetType, targetId: row.targetId }, receipt, block.timestamp, chain.cfg.registry);
    return true;
  });
}

/** Syncs every unfinished transaction, oldest first (so authorisations are mirrored before anchors that rely on them). */
export async function syncPending(db: ChainDb, chain: Env, opts: { limit?: number; now?: Date } = {}): Promise<SyncResult[]> {
  const rows = await db.blockchainTransaction.findMany({
    where: { status: { in: ["PENDING", "CONFIRMED"] } },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take: opts.limit ?? 50,
    select: { id: true, status: true },
  });
  const results: SyncResult[] = [];
  for (const { id, status } of rows) {
    try {
      results.push(await syncTransaction(db, chain, id, { now: opts.now }));
    } catch (e) {
      // One bad transaction (e.g. an authorisation not mirrored yet, or an RPC error) must not stop the others; it is retried
      // next pass. A failed pass changes nothing, so the row's status is the one it had before (PENDING or CONFIRMED).
      results.push({ id, status, changed: false, error: e instanceof Error ? e.message : "sync failed" });
    }
  }
  return results;
}

// ───────────────────────────── admin range rescan ─────────────────────────────

export type RescanResult = { scanned: number; adopted: number; alreadyKnown: number; unattributed: string[] };

/**
 * Finds registry transactions in a block range that FARJI never recorded (for example a browser that
 * closed before reporting the hash) and, ONLY when they replace a recorded PENDING/DROPPED transaction
 * (same sender and nonce), records them with that transaction's purpose and target. Anything else is
 * written to the audit trail as unattributed and is NEVER guessed into application data.
 */
export async function rescanRange(db: ChainDb, chain: Env, actor: Actor, range: { fromBlock: number; toBlock: number }): Promise<RescanResult> {
  const admin = assertAdmin(actor);
  if (!Number.isInteger(range.fromBlock) || !Number.isInteger(range.toBlock) || range.fromBlock < 0 || range.toBlock < range.fromBlock || range.toBlock - range.fromBlock > 5000) {
    throw new DomainError("VALIDATION", "Invalid block range (at most 5000 blocks).");
  }
  const chainId = Number(chain.cfg.chainId);
  const logs = await chain.rpc.getLogs({ address: chain.cfg.registry, fromBlock: range.fromBlock, toBlock: range.toBlock });
  const hashes = [...new Set(logs.map((l) => l.transactionHash.toLowerCase()))];
  const result: RescanResult = { scanned: hashes.length, adopted: 0, alreadyKnown: 0, unattributed: [] };

  for (const txHash of hashes) {
    if (await db.blockchainTransaction.findUnique({ where: { chainId_txHash: { chainId, txHash } }, select: { id: true } })) {
      result.alreadyKnown += 1;
      continue;
    }
    const rpcTx = await chain.rpc.getTransaction(txHash);
    if (!rpcTx || !rpcTx.to || rpcTx.to.toLowerCase() !== chain.cfg.registry || rpcTx.chainId !== chain.cfg.chainId || !decodeRegistryCall(rpcTx.data)) {
      result.unattributed.push(txHash);
      continue;
    }
    const replaced = await db.blockchainTransaction.findFirst({
      where: { chainId, fromAddress: rpcTx.from.toLowerCase(), txNonce: BigInt(rpcTx.nonce), status: { in: ["PENDING", "DROPPED"] } },
    });
    if (!replaced) {
      result.unattributed.push(txHash);
      continue;
    }
    await db.blockchainTransaction.create({
      data: {
        chainId,
        txHash,
        purpose: replaced.purpose,
        targetType: replaced.targetType,
        targetId: replaced.targetId,
        targetSequence: replaced.targetSequence,
        fromAddress: replaced.fromAddress,
        initiatedByUserId: replaced.initiatedByUserId,
        organisationId: replaced.organisationId,
        txNonce: replaced.txNonce,
      },
    });
    if (replaced.status === "PENDING") {
      await db.blockchainTransaction.updateMany({ where: { id: replaced.id, status: "PENDING" }, data: { status: "DROPPED", failureReason: "replaced by an adopted transaction" } });
    }
    result.adopted += 1;
  }
  await db.auditEvent.create({
    data: {
      actorUserId: admin.userId,
      actorRole: "ADMIN",
      action: "CHAIN_RESCAN",
      targetType: "Chain",
      metadata: { fromBlock: range.fromBlock, toBlock: range.toBlock, scanned: result.scanned, adopted: result.adopted, alreadyKnown: result.alreadyKnown, unattributed: result.unattributed.slice(0, 50) },
    },
  });
  return result;
}
