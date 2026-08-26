import { DEMO_WALLETS } from "@/lib/crypto/demoWallets";
import type { IssuerKeyRecord } from "./types";

// Demonstrates the key-rotation scenario from the project spec:
// XYZ Technologies Demo's original wallet was valid Jan 2026 - Jan 2027,
// then rotated. A credential signed in June 2026 (CRED-002) stays valid
// "at issuance time" under the old wallet even though that wallet is now
// revoked — see docs/ARCHITECTURE.md section 7.
//
// Wallet addresses come from lib/crypto/demoWallets.ts (well-known public
// Hardhat test accounts) so that Phase 5's real EIP-712 signing actually
// recovers a signer address that matches what this registry says is
// authorised.
export const issuerKeyHistory: IssuerKeyRecord[] = [
  {
    organisationId: "ORG-IITD",
    wallet: DEMO_WALLETS.IITD.address,
    validFrom: "2026-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
  {
    organisationId: "ORG-XYZ",
    wallet: DEMO_WALLETS.XYZ_ORIGINAL.address,
    validFrom: "2026-01-01",
    validUntil: "2027-01-01",
    status: "REVOKED",
  },
  {
    organisationId: "ORG-XYZ",
    wallet: DEMO_WALLETS.XYZ_ROTATED.address,
    validFrom: "2027-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
  {
    organisationId: "ORG-ABC",
    wallet: DEMO_WALLETS.ABC.address,
    validFrom: "2026-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
  {
    organisationId: "ORG-PQR",
    wallet: DEMO_WALLETS.PQR.address,
    validFrom: "2023-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
];
