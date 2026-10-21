import { DomainError } from "@/server/candidate/errors";
import type { ChainConfig } from "./config";
import type { ChainRpc } from "./rpc";

// Proof that the configured RPC endpoint is really the configured network and that a contract lives at the configured
// registry address (ROADMAP Phase 15). The provider is created with a chain id from configuration, which does NOT make the
// node agree; without this check a mainnet URL under a Sepolia chain id, or a wrong registry address, would be read as if it
// were right. Checked before any chain read or write is built, cached briefly on success, never cached on failure.

export class ChainMisconfiguredError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ChainMisconfiguredError";
  }
}

const OK_TTL_MS = 5 * 60_000;
const verified = new Map<string, number>();
const key = (cfg: ChainConfig) => `${cfg.rpcUrl}#${cfg.chainId}#${cfg.registry}`;

/** Test hook: forget cached successes. */
export const resetChainReadiness = () => verified.clear();

export async function ensureChainReady(chain: { cfg: ChainConfig; rpc: ChainRpc }, nowMs: number = Date.now()): Promise<void> {
  const k = key(chain.cfg);
  const at = verified.get(k);
  if (at !== undefined && nowMs - at < OK_TTL_MS) return;

  let reported: bigint;
  let code: string;
  try {
    reported = await chain.rpc.getChainId();
    code = await chain.rpc.getCode(chain.cfg.registry);
  } catch {
    // The node could not be reached or answered badly: temporary, and the person is told so without internals.
    throw new DomainError("CONFLICT", "The network is temporarily unavailable. Please try again in a moment.");
  }
  if (reported !== chain.cfg.chainId) {
    throw new ChainMisconfiguredError("This server is connected to the wrong network, so blockchain actions are disabled until it is corrected.");
  }
  if (!code || code === "0x") {
    throw new ChainMisconfiguredError("The FARJI registry contract was not found on this network, so blockchain actions are disabled until it is corrected.");
  }
  verified.set(k, nowMs);
}
