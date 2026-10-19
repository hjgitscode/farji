import { isAddress } from "ethers";
import type { Eip712Config } from "@/lib/crypto/eip712";

// Server-only EIP-712 domain configuration. There is deliberately NO default: issuance is
// disabled until the chain id and the FarjiRegistry address are configured, and every
// environment (local, preview, production) must use its own deployment, so signatures cannot be
// replayed across environments (SECURITY_MODEL: cross-chain / cross-contract replay).

export function getEip712Config(env: Record<string, string | undefined> = process.env): Eip712Config {
  const rawChain = env.FARJI_CHAIN_ID;
  const rawContract = env.FARJI_REGISTRY_ADDRESS;
  if (!rawChain || !/^[1-9][0-9]{0,15}$/.test(rawChain)) {
    throw new Error("FARJI_CHAIN_ID is not set to a positive integer; credential signing is disabled");
  }
  if (!rawContract || !isAddress(rawContract)) {
    throw new Error("FARJI_REGISTRY_ADDRESS is not set to a valid address; credential signing is disabled");
  }
  return { chainId: BigInt(rawChain), verifyingContract: rawContract.toLowerCase() };
}
