import type { IssuerKeyRecord } from "./types";

// Demonstrates the key-rotation scenario from the project spec:
// XYZ Technologies Demo's original wallet was valid Jan 2026 - Jan 2027,
// then rotated. A credential signed in June 2026 (CRED-002) stays valid
// "at issuance time" under the old wallet even though that wallet is now
// revoked — see docs/ARCHITECTURE.md section 7.
export const issuerKeyHistory: IssuerKeyRecord[] = [
  {
    organisationId: "ORG-IITD",
    wallet: "0x1111111111111111111111111111111111d001",
    validFrom: "2026-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
  {
    organisationId: "ORG-XYZ",
    wallet: "0x2222222222222222222222222222222222a001",
    validFrom: "2026-01-01",
    validUntil: "2027-01-01",
    status: "REVOKED",
  },
  {
    organisationId: "ORG-XYZ",
    wallet: "0x2222222222222222222222222222222222a002",
    validFrom: "2027-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
  {
    organisationId: "ORG-ABC",
    wallet: "0x3333333333333333333333333333333333c001",
    validFrom: "2026-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
  {
    organisationId: "ORG-PQR",
    wallet: "0x4444444444444444444444444444444444e001",
    validFrom: "2023-01-01",
    validUntil: null,
    status: "ACTIVE",
  },
];
