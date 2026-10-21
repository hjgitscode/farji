import { randomBytes } from "node:crypto";
import { registryInterface, type LogLike } from "@/lib/blockchain/registry";
import type { ChainRpc, RpcBlock, RpcLog, RpcReceipt, RpcTx } from "@/server/chain/rpc";
import type { ChainReader } from "@/server/chain/reader";

// A scripted stand-in for the node's READ surface, used ONLY by the unit/database tests of the
// transaction state machine and the finalised-evidence mirror (tests/db/chain-*.test.ts), where a
// scenario such as "the block was reorged away" or "the nonce was consumed by another tx" must be
// forced. It can send nothing and signs nothing. Everything that matters end-to-end (real
// transactions, real contract events, real receipts, a real reorg via snapshot revert) is proven
// against an actual local Hardhat node in tests/chain-int. Never imported outside tests/.

export const hex32 = () => "0x" + randomBytes(32).toString("hex");
export const REGISTRY = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

export class FakeRpc implements ChainRpc {
  latest = 100;
  finalized = 100;
  txs = new Map<string, RpcTx>();
  receipts = new Map<string, RpcReceipt>();
  blocks = new Map<number, RpcBlock>();
  nonces = new Map<string, number>(); // address -> settled transaction count
  logs: RpcLog[] = [];
  chainId = 31337n;
  /** Code at the registry address ("0x" = nothing deployed). */
  code = "0x6001";

  async getBlockNumber() {
    return this.latest;
  }
  async getBlock(tag: number | "latest" | "finalized"): Promise<RpcBlock | null> {
    const n = tag === "latest" ? this.latest : tag === "finalized" ? this.finalized : tag;
    return this.blocks.get(n) ?? { number: n, hash: "0x" + n.toString(16).padStart(64, "0"), timestamp: 1_760_000_000 + n };
  }
  async getTransaction(hash: string) {
    return this.txs.get(hash.toLowerCase()) ?? null;
  }
  async getTransactionReceipt(hash: string) {
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
  async getTransactionCount(address: string) {
    return this.nonces.get(address.toLowerCase()) ?? 0;
  }
  async getLogs() {
    return this.logs;
  }
  async getChainId() {
    return this.chainId;
  }
  async getCode() {
    return this.code;
  }

  /** Makes a transaction known to the node (mempool). */
  addTx(tx: Partial<RpcTx> & { data: string }): RpcTx {
    const full: RpcTx = {
      hash: tx.hash ?? hex32(),
      from: (tx.from ?? "0x" + "ab".repeat(20)).toLowerCase(),
      to: tx.to === undefined ? REGISTRY : tx.to,
      data: tx.data,
      chainId: tx.chainId ?? 31337n,
      nonce: tx.nonce ?? 0,
    };
    this.txs.set(full.hash.toLowerCase(), full);
    return full;
  }

  /** Mines a transaction into a block with the given logs. Returns the receipt. */
  mine(hash: string, block: number, logs: LogLike[] = [], status = 1): RpcReceipt {
    const blockHash = "0x" + block.toString(16).padStart(62, "0") + "aa";
    this.blocks.set(block, { number: block, hash: blockHash, timestamp: 1_760_000_000 + block });
    const receipt: RpcReceipt = { status, blockNumber: block, blockHash, logs };
    this.receipts.set(hash.toLowerCase(), receipt);
    return receipt;
  }

  /** A reorg: the transaction's block is no longer canonical. */
  reorgAway(hash: string) {
    const r = this.receipts.get(hash.toLowerCase());
    if (r) this.blocks.set(r.blockNumber, { number: r.blockNumber, hash: "0x" + "ee".repeat(32), timestamp: 1_760_000_000 + r.blockNumber });
    this.receipts.delete(hash.toLowerCase());
  }
}

/** An encoded registry event, exactly as the contract would emit it (topics + data). */
export function eventLog(name: string, args: Record<string, unknown>, address: string = REGISTRY): LogLike {
  const fragment = registryInterface.getEvent(name);
  if (!fragment) throw new Error(`Unknown event ${name}`);
  const { data, topics } = registryInterface.encodeEventLog(
    fragment,
    fragment.inputs.map((i) => args[i.name]),
  );
  return { address, topics, data };
}

/** A chain reader whose answers are set by the test (never connected to anything). */
export class FakeReader implements ChainReader {
  admins = new Set<string>();
  authorised = true;
  heads = new Map<string, { chainRoot: string; epoch: bigint }>();
  lastSeq = 0n;
  async isIssuerAuthorisedAt() {
    return this.authorised;
  }
  async getChainHead(orgId: string, type: "COHORT" | "PROOF_PULSE") {
    return this.heads.get(`${orgId}:${type}`) ?? { chainRoot: "0x" + "00".repeat(32), epoch: 0n };
  }
  async getLastPulseRootSeq() {
    return this.lastSeq;
  }
  async hasPlatformAdminRole(address: string) {
    return this.admins.has(address.toLowerCase());
  }
}
