import type { Actor } from "@/lib/auth/authorize";
import { decodeRegistryCall } from "@/lib/blockchain/registry";
import type { TxPurpose, TxStatus, TxTargetType } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";
import { inTransaction, isUuid, type Tx } from "@/server/issuance/common";
import type { IssuerScope } from "@/server/issuer/review";
import { isAdminPurpose, paramsFromCall, resolveAction, scopeFor, type ActionParams, type ActionScope, type ChainDb } from "./actions";
import type { ChainContext } from "./context";

// Server-built transactions and the recording of hashes a browser wallet reports (Phase 9).
//
// BUILD: the server constructs `{ to, data, chainId }` from trusted database state and chain reads.
// RECORD: the browser reports only a tx hash; the server fetches that transaction from its own RPC,
// checks chain, registry address, decoded function, calldata and sender authority, and only then
// inserts a PENDING BlockchainTransaction. Nothing the client says about a transaction is trusted.

export type BuiltTransaction = {
  to: string;
  data: string;
  chainId: string;
  purpose: TxPurpose;
  targetType: TxTargetType;
  targetId: string;
  targetSequence: number | null;
  warnings: string[];
};

type Env = Pick<ChainContext, "cfg" | "reader">;

export async function buildTransaction(
  db: ChainDb,
  chain: Env,
  actor: Actor,
  purpose: TxPurpose,
  targetId: string,
  params: ActionParams = {},
  opts: { now?: Date } = {},
): Promise<BuiltTransaction> {
  const scope = scopeFor(actor, purpose);
  const now = opts.now ?? new Date();

  return inTransaction(db, async (tx) => {
    const resolved = await resolveAction(tx as unknown as ChainDb, scope, purpose, targetId, params, { now, enforceAnchorDelay: true });

    let previous: string | undefined;
    if (resolved.chain && resolved.orgId) {
      // The contract enforces the chain head; the server reads it so the transaction is built on the current one.
      previous = (await chain.reader.getChainHead(resolved.orgId, resolved.chain)).chainRoot;
      if (resolved.chain === "PROOF_PULSE" && resolved.targetSequence !== null) {
        const last = await chain.reader.getLastPulseRootSeq(resolved.orgId);
        if (BigInt(resolved.targetSequence) < last) {
          throw new DomainError("CONFLICT", "A newer ProofPulse root has already been anchored on-chain.");
        }
      }
    }
    return {
      to: chain.cfg.registry,
      data: resolved.encode(previous),
      chainId: chain.cfg.chainId.toString(),
      purpose,
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      targetSequence: resolved.targetSequence,
      warnings: resolved.warnings,
    };
  });
}

export type RecordedTransaction = { id: string; status: TxStatus; alreadyRecorded: boolean };

export type RecordOptions = {
  now?: Date;
  /** The node may need a moment to show a just-broadcast transaction. */
  attempts?: number;
  delayMs?: number;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function visibleTo(scope: ActionScope, row: { initiatedByUserId: string; organisationId: string | null }): boolean {
  if (scope.kind === "ADMIN") return true;
  return row.organisationId === scope.organisationId;
}

export async function recordSubmittedTransaction(
  db: ChainDb,
  chain: Pick<ChainContext, "cfg" | "reader" | "rpc">,
  actor: Actor,
  input: { purpose: TxPurpose; targetId: string; txHash: string },
  opts: RecordOptions = {},
): Promise<RecordedTransaction> {
  const scope = scopeFor(actor, input.purpose);
  if (typeof input.txHash !== "string" || !HASH.test(input.txHash)) throw new DomainError("VALIDATION", "Invalid transaction hash.", { txHash: "Invalid transaction hash." });
  if (!isUuid(input.targetId)) throw new DomainError("NOT_FOUND", "Target not found.");
  const txHash = input.txHash.toLowerCase();
  const chainId = Number(chain.cfg.chainId);
  const now = opts.now ?? new Date();

  // Idempotent: reporting the same hash twice returns the same row (never a duplicate).
  const existing = await db.blockchainTransaction.findUnique({ where: { chainId_txHash: { chainId, txHash } } });
  if (existing) {
    if (!visibleTo(scope, existing)) throw new DomainError("NOT_FOUND", "Transaction not found.");
    return { id: existing.id, status: existing.status, alreadyRecorded: true };
  }

  // The server retrieves the transaction ITSELF.
  let rpcTx = null;
  for (let attempt = 0; attempt < (opts.attempts ?? 10); attempt++) {
    rpcTx = await chain.rpc.getTransaction(txHash);
    if (rpcTx) break;
    await sleep(opts.delayMs ?? 1000);
  }
  if (!rpcTx) throw new DomainError("CONFLICT", "The node does not know this transaction (yet). Try again in a moment.");
  if (rpcTx.chainId !== chain.cfg.chainId) throw new DomainError("VALIDATION", "The transaction is for a different chain.");
  if (!rpcTx.to || rpcTx.to.toLowerCase() !== chain.cfg.registry) throw new DomainError("VALIDATION", "The transaction is not addressed to the FARJI registry.");

  const call = decodeRegistryCall(rpcTx.data);
  if (!call) throw new DomainError("VALIDATION", "The transaction is not a FarjiRegistry call.");
  const from = rpcTx.from.toLowerCase();

  // Sender authority that does not need the database.
  if (isAdminPurpose(input.purpose) && !(await chain.reader.hasPlatformAdminRole(from))) {
    throw new DomainError("FORBIDDEN", "The sending wallet is not a platform admin wallet.");
  }

  return inTransaction(db, async (tx) => {
    const resolved = await resolveAction(tx as unknown as ChainDb, scope, input.purpose, input.targetId, paramsFromCall(input.purpose, call), {
      now,
      enforceAnchorDelay: false, // a sent transaction is judged by the chain, not re-refused here
    });
    if (call.name !== resolved.fn) throw new DomainError("VALIDATION", "The transaction calls a different function than this action allows.");
    const claimedPrevious = typeof call.args.expectedPreviousChainRoot === "string" ? call.args.expectedPreviousChainRoot : undefined;
    if (resolved.encode(claimedPrevious).toLowerCase() !== rpcTx.data.toLowerCase()) {
      throw new DomainError("VALIDATION", "The transaction's calldata does not match this action.");
    }

    if (scope.kind === "ISSUER") await requireIssuerSender(tx, scope, from);

    const row = await tx.blockchainTransaction.create({
      data: {
        chainId,
        txHash,
        purpose: input.purpose,
        targetType: resolved.targetType,
        targetId: resolved.targetId,
        targetSequence: resolved.targetSequence,
        fromAddress: from,
        initiatedByUserId: scope.userId,
        organisationId: resolved.organisationId,
        txNonce: BigInt(rpcTx.nonce),
      },
      select: { id: true, status: true },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: scope.userId,
        actorRole: scope.kind,
        organisationId: resolved.organisationId,
        action: "CHAIN_TX_RECORDED",
        targetType: "BlockchainTransaction",
        targetId: row.id,
        metadata: { purpose: input.purpose, targetType: resolved.targetType, targetId: resolved.targetId, txHash },
      },
    });
    return { id: row.id, status: row.status, alreadyRecorded: false };
  });
}


/**
 * The sender must be a wallet of the actor's OWN organisation whose authorisation is FINALIZED on-chain
 * (mirror), and, if the wallet is bound to an operator, that operator must be the actor.
 */
async function requireIssuerSender(tx: Tx, scope: IssuerScope, from: string): Promise<void> {
  const key = await tx.issuerKey.findFirst({
    where: { walletAddress: from, organisationId: scope.organisationId },
    select: { operatorMemberId: true, authoriseTransaction: { select: { status: true } } },
  });
  if (!key || key.authoriseTransaction?.status !== "FINALIZED") {
    throw new DomainError("FORBIDDEN", "The sending wallet is not an authorised issuer wallet of your organisation.");
  }
  if (key.operatorMemberId && key.operatorMemberId !== scope.memberId) {
    throw new DomainError("FORBIDDEN", "This wallet is operated by a different member of your organisation.");
  }
}

