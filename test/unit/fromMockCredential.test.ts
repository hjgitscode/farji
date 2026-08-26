import { describe, expect, it } from "vitest";
import { toCanonicalInput } from "@/lib/crypto/fromMockCredential";
import { canonicaliseCredential } from "@/lib/crypto/canonicalise";
import { getCredentialById } from "@/lib/services/candidateService";

describe("toCanonicalInput", () => {
  it("maps a real mock credential into a canonicalisable input", () => {
    const credential = getCredentialById("CRED-002");
    if (!credential) throw new Error("fixture CRED-002 missing from mock data");

    const input = toCanonicalInput(credential);
    expect(input.candidateRef).toBe(credential.candidateId);

    const canonical = canonicaliseCredential(input);
    expect(canonical.claimType).toBe("EMPLOYMENT");
    expect(canonical.lifecycleType).toBe("CONTINUING");
  });
});
