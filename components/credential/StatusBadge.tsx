import { Badge } from "@/components/ui/Badge";
import type { CredentialState } from "@/lib/mock-data/types";

const toneByState: Record<CredentialState, "gray" | "amber" | "blue" | "green" | "red" | "slate"> = {
  SELF_DECLARED: "gray",
  PENDING: "amber",
  VERIFIED: "blue",
  PERMANENT_VALID: "green",
  CURRENTLY_ATTESTED: "green",
  STALE_NO_RECENT_ATTESTATION: "amber",
  EXPIRED: "red",
  ENDED: "slate",
  REVOKED: "red",
  MODIFIED: "amber",
  INVALID_PROOF: "red",
};

const labelByState: Record<CredentialState, string> = {
  SELF_DECLARED: "Self-declared",
  PENDING: "Pending verification",
  VERIFIED: "Verified",
  PERMANENT_VALID: "Permanently valid",
  CURRENTLY_ATTESTED: "Currently attested",
  STALE_NO_RECENT_ATTESTATION: "Stale — no recent attestation",
  EXPIRED: "Expired",
  ENDED: "Ended",
  REVOKED: "Revoked",
  MODIFIED: "Modified",
  INVALID_PROOF: "Invalid proof",
};

export function StatusBadge({ state }: { state: CredentialState }) {
  return <Badge tone={toneByState[state]}>{labelByState[state]}</Badge>;
}
