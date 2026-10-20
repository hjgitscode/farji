import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecordCard } from "@/components/candidate/RecordCard";
import { VerificationStatus } from "@/components/candidate/VerificationStatus";
import { EvidenceDetails } from "@/components/public/EvidenceDetails";
import { PublicRecordCard } from "@/components/public/PublicRecordCard";
import { Alert, StatusBadge } from "@/components/ui";
import { QrCode } from "@/components/ui/QrCode";
import { buildProofBundle } from "@/lib/verification/bundle";
import { deriveClaimState, deriveCredentialState } from "@/lib/verification/derive";
import { presentState } from "@/lib/verification/present";
import type { PublicRecord } from "@/server/public/read";
import type { CandidateRecord } from "@/server/verification/records";
import { addMs, cohortBuilt, days, ISSUED_AT, POLICY } from "../fixtures/evidence";

// Render tests for the product components: they take the engine's results and must show them honestly, distinguish
// verified from self-declared, and keep technical detail and private data out of the default view.

const NOW = addMs(ISSUED_AT, days(10));

const content = { title: "Software Engineer", organisationName: "Acme Ltd", startDate: "2022-01-10", endDate: "2024-03-31" };
const selfDeclared = deriveClaimState({ claimId: "c", proposedLifecycleType: "PERMANENT", requestInProgress: false, requestedOrganisation: null, credential: null }, NOW, POLICY);

function publicRecord(result: PublicRecord["result"], over: Partial<PublicRecord> = {}): PublicRecord {
  return {
    index: 0,
    category: "EXPERIENCE",
    title: content.title,
    organisationName: content.organisationName,
    startDate: content.startDate,
    endDate: content.endDate,
    expiryDate: "",
    description: "",
    location: "",
    fieldOfStudy: "",
    credentialNumber: "",
    lifecycleType: "PERMANENT",
    group: "SELF_DECLARED",
    result,
    verifyRef: null,
    ...over,
  };
}

describe("public record card", () => {
  it("a verified record says who confirmed it and links to the verifier", async () => {
    const b = await cohortBuilt();
    const result = deriveCredentialState(b.ev, NOW, b.policy);
    const html = renderToStaticMarkup(<PublicRecordCard record={publicRecord(result, { group: "VERIFIED", verifyRef: b.material.credentialId })} />);
    expect(html).toContain("Verified historical credential");
    expect(html).toContain("Confirmed by Acme Ltd");
    expect(html).toContain(`/verify/${b.material.credentialId}`);
    expect(html).toContain("border-emerald-200");
  });

  it("a self-declared record is plainly self-declared: no confirmer, no verifier link, a different look", () => {
    const html = renderToStaticMarkup(<PublicRecordCard record={publicRecord(selfDeclared)} />);
    expect(html).toMatch(/Self-declared/);
    expect(html).not.toContain("Confirmed by");
    expect(html).not.toContain("/verify/");
    expect(html).not.toContain("border-emerald");
    expect(html).toContain("border-dashed");
    expect(html).not.toMatch(/Verified/);
  });

  it("revoked, expired and stale records say so", async () => {
    const b = await cohortBuilt({ lifecycle: "EXPIRING" });
    const expired = deriveCredentialState(b.ev, new Date("2028-01-01T00:00:00Z"), b.policy);
    expect(renderToStaticMarkup(<PublicRecordCard record={publicRecord(expired, { group: "VERIFIED" })} />)).toContain("Expired on 31 Mar 2027");
    const revoked = { ...selfDeclared, state: "REVOKED" as const, revokedAt: NOW, organisation: { id: "o", displayName: "Acme Ltd" } };
    expect(renderToStaticMarkup(<PublicRecordCard record={publicRecord(revoked, { group: "ATTENTION" })} />)).toContain("Credential revoked");
  });
});

describe("candidate record card and status", () => {
  const record = (over: Partial<CandidateRecord> = {}): CandidateRecord => ({
    claimId: "claim-1",
    category: "EXPERIENCE",
    visibility: "PRIVATE",
    archivedAt: null,
    createdAt: NOW,
    current: { versionId: "v2", versionNumber: 2, createdAt: NOW, content, proposedLifecycleType: "PERMANENT", credentialResult: null },
    result: selfDeclared,
    versions: [],
    earlierVerified: null,
    credentialRef: null,
    ...over,
  });

  it("shows the derived state in plain words and never the workflow status", () => {
    const html = renderToStaticMarkup(<RecordCard record={record()} available />);
    expect(html).toContain("Added by you · not yet verified");
    expect(html).toContain("Private");
    expect(html).not.toMatch(/AWAITING_SIGNATURE|QUEUED_FOR_ANCHOR|ANCHORED|SIGNED/);
  });

  it("says an earlier version was verified, without badging the new version as verified", () => {
    const html = renderToStaticMarkup(<RecordCard record={record({ earlierVerified: { versionNumber: 1, organisationName: "Acme Ltd" } })} available />);
    expect(html).toContain("An earlier version of this record was verified by Acme Ltd");
    expect(html).toContain("The current version is not verified yet");
    expect(html).toContain("Self-declared");
    expect(html).not.toContain("Verified historical credential");
  });

  it("is honest when verification is unavailable", () => {
    expect(renderToStaticMarkup(<RecordCard record={record({ result: null })} available={false} />)).toContain("unavailable");
    expect(renderToStaticMarkup(<VerificationStatus result={undefined} available={false} />)).toContain("unavailable");
  });

  it("keeps the checks behind a collapsed 'View verification details' and hides them for self-declared records", async () => {
    const b = await cohortBuilt();
    const result = deriveCredentialState(b.ev, NOW, b.policy);
    const html = renderToStaticMarkup(<VerificationStatus result={result} available detail />);
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain("View verification details");
    expect(renderToStaticMarkup(<VerificationStatus result={selfDeclared} available detail />)).not.toContain("<details");
  });
});

describe("public evidence details", () => {
  it("are collapsed, contain public evidence and the download link, and no private value", async () => {
    const b = await cohortBuilt();
    const result = deriveCredentialState(b.ev, NOW, b.policy);
    const bundle = buildProofBundle({ evidence: b.ev, result, domain: b.policy.domain, now: NOW, anchorTx: { [b.ev.anchors[0].id]: { transactionHash: "0x" + "ab".repeat(32), blockNumber: "7" } } });
    const html = renderToStaticMarkup(<EvidenceDetails bundle={bundle} result={result} credentialRef={b.material.credentialId} />);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain("View verification details");
    expect(html).toContain(b.material.credentialId);
    expect(html).toContain("0x" + "ab".repeat(32));
    expect(html).toContain(`/verify/${b.material.credentialId}/bundle`);
    for (const secret of [b.material.credentialSalt, b.material.contentSalt, b.material.subjectSalt, b.material.attestation.nonce, b.material.candidateId]) expect(html).not.toContain(secret);
  });

  it("explain when there is no signed evidence yet", () => {
    const html = renderToStaticMarkup(<EvidenceDetails bundle={null} result={selfDeclared} credentialRef={"0x" + "00".repeat(32)} />);
    expect(html).toContain("no signed evidence");
  });
});

describe("shared components", () => {
  it("status badges carry a word and a glyph, never colour alone", () => {
    const html = renderToStaticMarkup(<StatusBadge presentation={presentState(selfDeclared)} />);
    expect(html).toContain("Self-declared");
    expect(html).toContain('aria-hidden="true"');
  });

  it("errors are announced as alerts", () => {
    expect(renderToStaticMarkup(<Alert tone="error">Something failed</Alert>)).toContain('role="alert"');
  });

  it("a QR code encodes only the link and is labelled", async () => {
    const url = "https://farji.example/verify/0x" + "ab".repeat(32);
    const html = renderToStaticMarkup(await QrCode({ url, label: "QR code for the link" }));
    expect(html).toContain("<svg");
    expect(html).toContain('aria-label="QR code for the link"');
    expect(html).not.toContain("salt");
  });
});
