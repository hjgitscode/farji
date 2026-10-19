import { getChainConfig, type ChainConfig } from "./config";
import { createChainReader, type ChainReader } from "./reader";
import { ethersRpc, getProvider, type ChainRpc } from "./rpc";

// The configured chain, assembled lazily from the environment. Importing this module never
// requires configuration; calling `getChain()` does (and fails clearly when chain features are off).

export type ChainContext = { cfg: ChainConfig; rpc: ChainRpc; reader: ChainReader };

let cached: { key: string; ctx: ChainContext } | null = null;

export function getChain(env: Record<string, string | undefined> = process.env): ChainContext {
  const cfg = getChainConfig(env);
  const key = JSON.stringify([cfg.rpcUrl, cfg.chainId.toString(), cfg.registry, cfg.finality]);
  if (!cached || cached.key !== key) {
    const provider = getProvider(cfg);
    cached = { key, ctx: { cfg, rpc: ethersRpc(provider), reader: createChainReader(provider, cfg) } };
  }
  return cached.ctx;
}
