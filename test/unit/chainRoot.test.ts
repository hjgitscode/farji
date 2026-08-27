import { describe, expect, it } from "vitest";
import { AbiCoder, keccak256 } from "ethers";
import { computeChainRoot, GENESIS_CHAIN_ROOT } from "@/lib/merkle/chainRoot";
import { keccak256Utf8 } from "@/lib/crypto/hash";

describe("computeChainRoot", () => {
  const batchRoot = keccak256Utf8("batch-1");

  it("matches a manual abi.encode(...) + keccak256 computation", () => {
    const organisationId = "ORG-XYZ";
    const params = {
      batchRoot,
      previousChainRoot: GENESIS_CHAIN_ROOT,
      organisationId,
      attestationType: "PROOF_PULSE" as const,
      epoch: 1,
    };

    const expected = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "uint8", "uint64"],
        [batchRoot, GENESIS_CHAIN_ROOT, keccak256Utf8(organisationId), 1, 1],
      ),
    );

    expect(computeChainRoot(params)).toBe(expected);
  });

  it("changes when the epoch changes", () => {
    const base = {
      batchRoot,
      previousChainRoot: GENESIS_CHAIN_ROOT,
      organisationId: "ORG-XYZ",
      attestationType: "PROOF_PULSE" as const,
    };
    expect(computeChainRoot({ ...base, epoch: 1 })).not.toBe(computeChainRoot({ ...base, epoch: 2 }));
  });

  it("changes when the attestation type changes (COHORT vs PROOF_PULSE)", () => {
    const base = {
      batchRoot,
      previousChainRoot: GENESIS_CHAIN_ROOT,
      organisationId: "ORG-XYZ",
      epoch: 1,
    };
    expect(computeChainRoot({ ...base, attestationType: "COHORT" })).not.toBe(
      computeChainRoot({ ...base, attestationType: "PROOF_PULSE" }),
    );
  });

  it("chains a second epoch onto the first correctly", () => {
    const organisationId = "ORG-XYZ";
    const augustRoot = keccak256Utf8("august-batch");
    const septemberRoot = keccak256Utf8("september-batch");

    const augustChainRoot = computeChainRoot({
      batchRoot: augustRoot,
      previousChainRoot: GENESIS_CHAIN_ROOT,
      organisationId,
      attestationType: "PROOF_PULSE",
      epoch: 1,
    });

    const septemberChainRoot = computeChainRoot({
      batchRoot: septemberRoot,
      previousChainRoot: augustChainRoot,
      organisationId,
      attestationType: "PROOF_PULSE",
      epoch: 2,
    });

    // Anchoring September against the wrong previous root gives a
    // different chain root — this is what the contract's "Invalid
    // previous chain root" check catches.
    const forkedChainRoot = computeChainRoot({
      batchRoot: septemberRoot,
      previousChainRoot: GENESIS_CHAIN_ROOT,
      organisationId,
      attestationType: "PROOF_PULSE",
      epoch: 2,
    });

    expect(septemberChainRoot).not.toBe(forkedChainRoot);
  });
});
