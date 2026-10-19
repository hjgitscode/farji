import { Wallet } from "ethers";

// TEST-ONLY wallets. This file is the ONLY place a private key may exist in the repository:
// production code (lib/, server/, app/) never holds, generates or accepts one, and a structural
// test (tests/crypto/no-private-keys.test.ts) enforces that.

/** Hardhat's well-known public development account #0. Worthless outside tests. */
export const HARDHAT_ACCOUNT_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const TEST_CHAIN_ID = 31337n;
/** A fixed arbitrary address standing in for the FarjiRegistry (no contract exists yet). */
export const TEST_REGISTRY = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
export const TEST_CONFIG = { chainId: TEST_CHAIN_ID, verifyingContract: TEST_REGISTRY };

/** What the tests need from a wallet (a `Wallet` or a random `HDNodeWallet`). */
export type TestWallet = Pick<Wallet, "address" | "signTypedData">;

export const deterministicWallet = () => new Wallet(HARDHAT_ACCOUNT_0_KEY);
export const freshWallet = () => Wallet.createRandom();

/**
 * A chain-view stand-in for the pre-Phase-9 DATABASE tests only (tests/db/issuance, cohort, pulse): they
 * exercise signing, Merkle and database rules and are not about the chain read. It answers "authorised"
 * for everything. Every chain-facing behaviour is tested against a REAL local Hardhat node in
 * tests/chain-int, and D46 itself (a denying chain view) is tested in tests/db/chain-signing.test.ts.
 * It must never be used outside tests/.
 */
export const PERMISSIVE_CHAIN_VIEW = { isIssuerAuthorisedAt: async () => true };
