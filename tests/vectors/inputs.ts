import { isoDateToUnixSeconds } from "@/lib/crypto/encoding";

// Fixed inputs for the golden vectors (tests/vectors/crypto.json). Phase 8 Solidity tests must
// reproduce the committed outputs from these exact inputs.

export const rep = (byte: string) => "0x" + byte.repeat(32);

export const V = {
  orgId: rep("11"),
  credentialSalt: rep("aa"),
  contentSalt: rep("bb"),
  subjectSalt: rep("cc"),
  nonce: rep("dd"),
  subjectUuid: "01990000-0000-7000-8000-000000000001",
  category: "EXPERIENCE" as const,
  lifecycle: "PERMANENT" as const,
  content: { title: "Software Engineer", organisationName: "Acme Ltd", startDate: "2022-01-10", endDate: "2024-03-31" },
  validFrom: isoDateToUnixSeconds("2022-01-10"),
  validUntil: 0n,
  issuedAt: 1760000000n,
  chainId: 31337n,
  verifyingContract: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  // status change
  effectiveAt: 1740000000n,
  statusSeq: 2,
  leafIndex: 0,
  // chain root
  batchRoot: rep("22"),
  previousChainRoot: "0x" + "00".repeat(32),
  epoch: 1n,
};
