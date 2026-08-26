import { HDNodeWallet, Mnemonic } from "ethers";

/**
 * Demo issuer wallets for Review 2.
 *
 * Derived from "test test test test test test test test test test test
 * junk" — the standard public test mnemonic that Hardhat (and most
 * Ethereum dev tooling) uses for its default local accounts. These hold
 * no real funds on any real network and are printed by `npx hardhat node`
 * on every developer's machine, so deriving them here is safe to commit —
 * this is NOT the "never put private keys in source code" rule being
 * broken; that rule is about real, funded, production keys, which these
 * are the opposite of. Real issuer keys in Review 3 come from environment
 * variables / a proper signer, never from source.
 *
 * Deriving from the mnemonic at load time (rather than hand-copying long
 * private key hex strings) means these are correct by construction, not
 * by careful transcription.
 *
 * Each organisation's demo wallet here matches the address recorded for
 * it in lib/mock-data/issuerKeys.ts, so signing a credential with the
 * matching private key and recovering the signer actually lines up with
 * what the issuer registry says is authorised — exactly what Phase 5's
 * "correct signer recovered" exit criterion demonstrates.
 */
export interface DemoWallet {
  address: string;
  privateKey: string;
}

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC);

function deriveAccount(index: number): DemoWallet {
  const wallet = HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`);
  return { address: wallet.address, privateKey: wallet.privateKey };
}

export const DEMO_WALLETS = {
  /** IIT Delhi Demo Issuer — Hardhat default account #0. */
  IITD: deriveAccount(0),
  /** XYZ Technologies Demo — original wallet, rotated in Jan 2027. Hardhat account #1. */
  XYZ_ORIGINAL: deriveAccount(1),
  /** XYZ Technologies Demo — wallet after rotation. Hardhat account #2. */
  XYZ_ROTATED: deriveAccount(2),
  /** ABC Certification Authority Demo — Hardhat account #3. */
  ABC: deriveAccount(3),
  /** PQR Innovations Demo — Hardhat account #4. */
  PQR: deriveAccount(4),
} as const satisfies Record<string, DemoWallet>;

export function findDemoWalletByAddress(address: string): DemoWallet | undefined {
  return Object.values(DEMO_WALLETS).find((w) => w.address.toLowerCase() === address.toLowerCase());
}
