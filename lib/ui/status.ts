import type { Tone } from "@/lib/verification/present";

// Presentation of the two NON-verification status families. They are workflow/transaction facts, never verification
// states: a verification state always comes from the derived engine (lib/verification) and is presented by `presentState`.
// The groups mirror the product's status language: trust-positive, progress, caution, high risk, neutral.

export type StatusDisplay = { tone: Tone; label: string; note: string; icon: "check" | "clock" | "ellipsis" | "alert" | "x" | "circle" };

/** Credential workflow (operational) status: where a signed record is on its way to being anchored. */
export const PIPELINE_STATUS: Record<string, StatusDisplay> = {
  AWAITING_SIGNATURE: { tone: "pending", label: "Awaiting signature", note: "Approved. Waiting for you to sign.", icon: "clock" },
  SIGNED: { tone: "pending", label: "Signed", note: "Signed. Waiting to join a batch.", icon: "ellipsis" },
  QUEUED_FOR_ANCHOR: { tone: "pending", label: "Queued for anchor", note: "Signed and queued in a batch. It is not final until the batch is closed, anchored and confirmed.", icon: "ellipsis" },
  ANCHORED: { tone: "verified", label: "Anchored", note: "Anchored and final.", icon: "check" },
};

/** Transaction status as the server tracks it. */
export const TX_STATUS: Record<string, StatusDisplay> = {
  PENDING: { tone: "pending", label: "Pending", note: "Submitted. Waiting to be recorded.", icon: "clock" },
  CONFIRMED: { tone: "attention", label: "Confirmed · not final", note: "Recorded but not final yet, so it does not count as evidence.", icon: "ellipsis" },
  FINALIZED: { tone: "verified", label: "Finalized", note: "Final. This now counts.", icon: "check" },
  FAILED: { tone: "danger", label: "Failed", note: "The network rejected it. Nothing changed; you can try again.", icon: "x" },
  DROPPED: { tone: "danger", label: "Replaced or dropped", note: "It was replaced or never recorded. Nothing changed; you can try again.", icon: "x" },
};

/** Batch (cohort) lifecycle as the issuer sees it. */
export const BATCH_STATUS: Record<string, { tone: Tone; label: string }> = {
  OPEN: { tone: "pending", label: "Collecting" },
  SEALED: { tone: "attention", label: "Ready to anchor" },
  ANCHORED: { tone: "verified", label: "Anchored" },
};

export const ORG_STATUS: Record<string, { tone: Tone; label: string; note: string }> = {
  PENDING_ONBOARDING: { tone: "pending", label: "Awaiting registration", note: "Register it on the network to activate it." },
  ACTIVE: { tone: "verified", label: "Active", note: "Can confirm records." },
  SUSPENDED: { tone: "attention", label: "Suspended", note: "Cannot make new confirmations." },
};
