import { Contract, type Provider } from "ethers";
import abi from "@/lib/blockchain/farji-registry.abi.json";
import type { ChainConfig } from "./config";

// Read-only views of FarjiRegistry state. The chain is authoritative for issuer key history,
// anchors and revocations; the database mirrors are never used to GRANT validity the chain does
// not show (DOMAIN_MODEL §3.5), so signing acceptance and transaction building consult this.

export type ChainAttestationType = "COHORT" | "PROOF_PULSE";

export interface ChainReader {
  /** FarjiRegistry.isIssuerAuthorisedAt(orgId, wallet, timestamp). */
  isIssuerAuthorisedAt(orgId: string, wallet: string, atSeconds: bigint): Promise<boolean>;
  /** The current head of one attestation chain (epoch 0 = empty, chainRoot = zero hash). */
  getChainHead(orgId: string, type: ChainAttestationType): Promise<{ chainRoot: string; epoch: bigint }>;
  getLastPulseRootSeq(orgId: string): Promise<bigint>;
  hasPlatformAdminRole(address: string): Promise<boolean>;
}

export function createChainReader(provider: Provider, cfg: Pick<ChainConfig, "registry">): ChainReader {
  const registry = new Contract(cfg.registry, abi as never, provider);
  const code = { COHORT: 0, PROOF_PULSE: 1 } as const;
  return {
    isIssuerAuthorisedAt: async (orgId, wallet, atSeconds) => Boolean(await registry.isIssuerAuthorisedAt(orgId, wallet, atSeconds)),
    getChainHead: async (orgId, type) => {
      const head = await registry.getChainHead(orgId, code[type]);
      return { chainRoot: String(head.chainRoot).toLowerCase(), epoch: BigInt(head.epoch) };
    },
    getLastPulseRootSeq: async (orgId) => BigInt(await registry.lastPulseRootSeq(orgId)),
    hasPlatformAdminRole: async (address) => Boolean(await registry.hasRole(await registry.PLATFORM_ADMIN_ROLE(), address)),
  };
}
