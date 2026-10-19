import { getEip712Config } from "@/server/issuance/config";

// Server-only chain configuration. There is no default RPC, chain or registry: chain features are
// disabled until each environment is configured, and each environment (local, preview,
// production) uses its OWN FarjiRegistry deployment.
//
//   FARJI_RPC_URL           JSON-RPC endpoint the SERVER reads (never a key-bearing URL for signing)
//   FARJI_CHAIN_ID          chain id the registry lives on
//   FARJI_REGISTRY_ADDRESS  FarjiRegistry address
//   FARJI_FINALITY          "finalized" (Sepolia/mainnet) or "depth:N" (local: depth:0 dev, depth:2 tests)

export type Finality = { mode: "finalized" } | { mode: "depth"; depth: number };

export type ChainConfig = {
  rpcUrl: string;
  chainId: bigint;
  registry: string; // lowercase address
  finality: Finality;
};

export function parseFinality(raw: string | undefined): Finality {
  const v = (raw ?? "finalized").trim();
  if (v === "finalized") return { mode: "finalized" };
  const m = /^depth:(\d{1,3})$/.exec(v);
  if (!m) throw new Error('FARJI_FINALITY must be "finalized" or "depth:N"');
  return { mode: "depth", depth: Number(m[1]) };
}

export function getChainConfig(env: Record<string, string | undefined> = process.env): ChainConfig {
  const { chainId, verifyingContract } = getEip712Config(env);
  const rpcUrl = env.FARJI_RPC_URL;
  if (!rpcUrl || !/^https?:\/\//.test(rpcUrl)) throw new Error("FARJI_RPC_URL is not set to an http(s) URL; chain features are disabled");
  return { rpcUrl, chainId, registry: verifyingContract, finality: parseFinality(env.FARJI_FINALITY) };
}
