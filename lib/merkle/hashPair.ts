import { concat, keccak256 } from "ethers";

/**
 * Combines two bytes32 node hashes into their parent hash, sorting the
 * pair first so that hashPair(a, b) === hashPair(b, a). This exact
 * convention — sort-then-concatenate-then-hash — is what OpenZeppelin's
 * `MerkleProof.sol` uses on-chain, so a proof built by this module
 * verifies correctly against `MerkleProof.verify` in Solidity too.
 */
export function hashPair(a: string, b: string): string {
  const [left, right] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}
