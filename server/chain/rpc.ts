import { JsonRpcProvider } from "ethers";
import type { LogLike } from "@/lib/blockchain/registry";
import type { ChainConfig } from "./config";

// The read-only RPC surface the sync and recording code depends on. Behind an interface so the
// state machine is unit-testable with a scripted fake, and the real thing runs against a local
// Hardhat node in the integration tests. The SERVER never signs: nothing here can send a transaction.

export type RpcTx = {
  hash: string;
  from: string;
  to: string | null;
  data: string;
  chainId: bigint;
  nonce: number;
};

export type RpcReceipt = {
  status: number | null;
  blockNumber: number;
  blockHash: string;
  logs: readonly LogLike[];
};

export type RpcBlock = { number: number; hash: string; timestamp: number };

export type BlockTag = number | "latest" | "finalized";

export type RpcLog = LogLike & { transactionHash: string; blockNumber: number };

export interface ChainRpc {
  getLogs(filter: { address: string; fromBlock: number; toBlock: number }): Promise<RpcLog[]>;
  getTransaction(hash: string): Promise<RpcTx | null>;
  getTransactionReceipt(hash: string): Promise<RpcReceipt | null>;
  getBlock(tag: BlockTag): Promise<RpcBlock | null>;
  getBlockNumber(): Promise<number>;
  getTransactionCount(address: string, tag: BlockTag): Promise<number>;
  /** `eth_chainId` as the node itself reports it (the provider is configured with a chain id; this proves the node agrees). */
  getChainId(): Promise<bigint>;
  getCode(address: string): Promise<string>;
}

/** Adapts an ethers provider to ChainRpc (read-only). */
export function ethersRpc(provider: JsonRpcProvider): ChainRpc {
  return {
    async getLogs(filter) {
      const logs = await provider.getLogs(filter);
      return logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, index: l.index, transactionHash: l.transactionHash, blockNumber: l.blockNumber }));
    },
    async getTransaction(hash) {
      const t = await provider.getTransaction(hash);
      return t ? { hash: t.hash, from: t.from, to: t.to, data: t.data, chainId: t.chainId, nonce: t.nonce } : null;
    },
    async getTransactionReceipt(hash) {
      const r = await provider.getTransactionReceipt(hash);
      return r ? { status: r.status, blockNumber: r.blockNumber, blockHash: r.blockHash, logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, index: l.index })) } : null;
    },
    async getBlock(tag) {
      const b = await provider.getBlock(tag);
      return b && b.hash ? { number: b.number, hash: b.hash, timestamp: b.timestamp } : null;
    },
    getBlockNumber: () => provider.getBlockNumber(),
    getTransactionCount: (address, tag) => provider.getTransactionCount(address, tag),
    getChainId: async () => BigInt((await provider.send("eth_chainId", [])) as string),
    getCode: (address) => provider.getCode(address),
  };
}

const g = globalThis as unknown as { farjiProvider?: { key: string; provider: JsonRpcProvider } };

/** The shared server provider (cached per URL + chain). Read-only. */
export function getProvider(cfg: ChainConfig): JsonRpcProvider {
  const key = `${cfg.rpcUrl}#${cfg.chainId}`;
  if (!g.farjiProvider || g.farjiProvider.key !== key) {
    g.farjiProvider = { key, provider: new JsonRpcProvider(cfg.rpcUrl, Number(cfg.chainId), { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 }) };
  }
  return g.farjiProvider.provider;
}
