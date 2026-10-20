import { PULSE_STATUS_CODE, SCOPE_CODE } from "@/lib/crypto/constants";
import { dateToUnixSeconds } from "@/lib/crypto/encoding";
import { pulseLeafHash, SparsePulseTree, verifyPulseProof, type PulseLogEntry } from "@/lib/merkle/pulse";
import {
  anchorCommonOutcomes,
  checkStatusChange,
  isFinalAnchor,
  pendingOutcome,
  record,
  verifyChainPrefix,
  windowOutcome,
  type CheckOutcome,
  type Collector,
  type LifecycleOutcome,
  type PathAssessment,
} from "./evidence";
import type { AnchorEvidence, CredentialEvidence, PulseEvidence, SignedMaterial, VerificationPolicy } from "./types";

// ProofPulse evidence path for CONTINUING credentials (MERKLE_MODEL §3, DOMAIN_MODEL §6.1 E).
//
// The engine REPLAYS the append-only update log into a sparse tree (every step must reproduce the recorded
// roots) and checks, for every FINALIZED PROOF_PULSE anchor whose rootSeq covers the leaf, that the anchored
// root equals the replayed root and the leaf folds into it. Nothing here rebuilds or mutates a tree because
// time passed: freshness is only a comparison of an anchor timestamp with `now`.

export type Snapshot = { root: string; leafHash: string; siblings: string[]; last: PulseEvidence["log"][number] | null };

/** One pass over the log, capturing the root, the leaf and its sibling path at each requested rootSeq. */
export function pulseSnapshots(depth: number, log: PulseEvidence["log"], leafIndex: number, rootSeqs: number[]): Map<number, Snapshot> {
  const wanted = new Set(rootSeqs);
  const tree = new SparsePulseTree(depth);
  const out = new Map<number, Snapshot>();
  let last: PulseEvidence["log"][number] | null = null;
  log.forEach((entry: PulseLogEntry & PulseEvidence["log"][number], i) => {
    if (entry.rootSeq !== i + 1) throw new Error("log gap");
    if (entry.previousRoot !== null && entry.previousRoot !== tree.root) throw new Error("previousRoot mismatch");
    if (tree.setLeaf(entry.leafIndex, entry.newLeafHash) !== entry.newRoot) throw new Error("newRoot mismatch");
    if (entry.leafIndex === leafIndex) last = entry;
    if (wanted.has(entry.rootSeq)) {
      const siblings = tree.proof(leafIndex);
      out.set(entry.rootSeq, { root: tree.root, leafHash: tree.lookup(0, leafIndex) ?? "", siblings, last });
    }
  });
  return out;
}

type LeafState = "ACTIVE" | "ENDED" | "UNVERIFIED" | "UNKNOWN";

export function assessPulsePath(ev: CredentialEvidence, m: SignedMaterial, policy: VerificationPolicy, c: Collector): PathAssessment {
  const pulse = ev.pulse;
  if (!pulse) {
    c.check("PULSE_LEAF", "PENDING", "The credential has not been queued in the ProofPulse tree yet.");
    c.reason("AWAITING_ANCHOR");
    return { status: "NONE", reason: "AWAITING_ANCHOR" };
  }
  const leafIndex = pulse.leaf.leafIndex;
  const activeHash = (() => {
    try {
      return pulseLeafHash({
        orgId: m.orgId,
        leafIndex,
        credentialId: m.credentialId,
        subjectCommitment: m.subjectCommitment,
        contentDigest: m.contentDigest,
        scope: SCOPE_CODE[pulse.leaf.scope],
        status: PULSE_STATUS_CODE.ACTIVE,
        statusEffectiveAt: dateToUnixSeconds(m.validFrom),
        statusSeq: 1,
      });
    } catch {
      return null;
    }
  })();

  // The insertion must be the one caused by THIS credential's attestation and carry the ACTIVE leaf rebuilt from it.
  const insert = pulse.log.find((e) => e.kind === "INSERT" && e.leafIndex === leafIndex);
  const insertOk = !!insert && activeHash !== null && insert.causedByAttestationId === m.attestation.id && insert.newLeafHash === activeHash;
  if (record(c, [{ id: "PULSE_LEAF", ok: insertOk, detail: "The tree's leaf was inserted from this credential's attestation.", reason: "PULSE_HISTORY_INCONSISTENT" }]).length > 0) {
    return { status: "INVALID" };
  }
  const insertSeq = insert!.rootSeq;

  const relevant = ev.anchors
    .filter((a) => a.attestationType === "PROOF_PULSE" && a.rootSeq !== null && a.rootSeq >= insertSeq)
    .sort((a, b) => a.epoch - b.epoch);
  const final = relevant.filter(isFinalAnchor);
  if (final.length === 0) {
    const reason = relevant.length > 0 ? "ANCHOR_NOT_FINAL" : "AWAITING_ANCHOR";
    c.check("ANCHOR_FINAL", "PENDING", relevant.length > 0 ? "A ProofPulse anchor exists but is not yet finalised." : "No ProofPulse epoch covers this credential yet.");
    c.reason(reason);
    return { status: "NONE", reason };
  }

  let snaps: Map<number, Snapshot>;
  try {
    snaps = pulseSnapshots(pulse.depth, pulse.log, leafIndex, final.map((a) => a.rootSeq!));
  } catch {
    record(c, [{ id: "PULSE_HISTORY", ok: false, detail: "The ProofPulse update log does not reproduce its recorded roots.", reason: "PULSE_HISTORY_INCONSISTENT" }]);
    return { status: "INVALID" };
  }
  c.check("PULSE_HISTORY", "PASS", "The ProofPulse update log reproduces every recorded root.");

  const states = new Map<number, LeafState>();
  const outcomes: CheckOutcome[] = [];
  for (const a of final) {
    outcomes.push(...anchorCommonOutcomes(a, m.organisationId, "PROOF_PULSE", policy));
    const snap = snaps.get(a.rootSeq!);
    const rootOk = !!snap && snap.root === a.batchRoot;
    outcomes.push({ id: "ANCHOR_ROOT", ok: rootOk, detail: `Epoch ${a.epoch} anchors the root recorded at rootSeq ${a.rootSeq}.`, reason: "ANCHOR_ROOT_MISMATCH" });
    if (!snap) continue;
    outcomes.push({
      id: "MERKLE_PROOF",
      ok: verifyPulseProof(a.batchRoot, pulse.depth, leafIndex, snap.leafHash, snap.siblings),
      detail: `The leaf folds into the root of epoch ${a.epoch}.`,
      reason: "MERKLE_PROOF_INVALID",
    });
    states.set(a.epoch, leafStateAt(snap, activeHash, ev, m, policy, leafIndex, c));
  }
  if (record(c, outcomes).length > 0 || [...states.values()].includes("UNKNOWN")) {
    if ([...states.values()].includes("UNKNOWN")) {
      record(c, [{ id: "PULSE_LEAF", ok: false, detail: "A anchored leaf matches neither an ACTIVE nor a recorded ENDED state.", reason: "PULSE_HISTORY_INCONSISTENT" }]);
    }
    return { status: "INVALID" };
  }

  const chain = verifyChainPrefix(ev.anchors, m.organisationId, m.orgId, "PROOF_PULSE", final[final.length - 1].epoch);
  if (chain.status === "BROKEN") {
    record(c, [{ id: "ANCHOR_CHAIN_CONTINUITY", ok: false, detail: chain.detail, reason: "ANCHOR_CHAIN_BROKEN" }]);
    return { status: "INVALID" };
  }
  if (chain.status === "GAP") {
    c.check("ANCHOR_CHAIN_CONTINUITY", "PENDING", chain.detail);
    c.reason("ANCHOR_CHAIN_INCOMPLETE");
    return { status: "NONE", reason: "ANCHOR_CHAIN_INCOMPLETE" };
  }
  c.check("ANCHOR_CHAIN_CONTINUITY", "PASS", chain.detail);

  // D7: the FIRST root containing the leaf must be anchored within the window after the attestation.
  const first = final[0];
  if (record(c, [windowOutcome(m.issuedAt, first.blockTimestamp, policy)]).length > 0) return { status: "INVALID" };

  const latestActive = [...final].reverse().find((a) => states.get(a.epoch) === "ACTIVE") ?? null;
  return { status: "OK", first, latestActive };
}

/** What a leaf was at an anchored root, from the recomputed ACTIVE hash or a VALID recorded ENDED status change. */
function leafStateAt(snap: Snapshot, activeHash: string | null, ev: CredentialEvidence, m: SignedMaterial, policy: VerificationPolicy, leafIndex: number, c: Collector): LeafState {
  if (activeHash !== null && snap.leafHash === activeHash) return "ACTIVE";
  const last = snap.last;
  if (!last || last.kind !== "STATUS_CHANGE") return "UNKNOWN";
  const att = ev.statusChanges.find((s) => s.id === last.causedByAttestationId);
  if (att && checkStatusChange(att, m, leafIndex, policy).ok && att.effectiveAt && att.statusSeq) {
    const endedHash = (() => {
      try {
        return pulseLeafHash({
          orgId: m.orgId,
          leafIndex,
          credentialId: m.credentialId,
          subjectCommitment: m.subjectCommitment,
          contentDigest: m.contentDigest,
          scope: SCOPE_CODE[ev.pulse!.leaf.scope],
          status: PULSE_STATUS_CODE.ENDED,
          statusEffectiveAt: dateToUnixSeconds(att.effectiveAt!),
          statusSeq: att.statusSeq!,
        });
      } catch {
        return null;
      }
    })();
    if (endedHash === snap.leafHash) return "ENDED";
  }
  // A recorded status change that does not verify is ignored for state purposes (integrity note only).
  c.check("STATUS_CHANGE", "FAIL", "A status change in the anchored tree failed verification and was ignored.");
  c.reason("STATUS_CHANGE_IGNORED");
  return "UNVERIFIED";
}

/** The first VALID ENDED status change (negative evidence: effective as soon as it verifies). */
export function findValidEnd(ev: CredentialEvidence, m: SignedMaterial, policy: VerificationPolicy, c: Collector): Date | null {
  if (!ev.pulse) return null;
  let endedAt: Date | null = null;
  for (const att of ev.statusChanges) {
    const res = checkStatusChange(att, m, ev.pulse.leaf.leafIndex, policy);
    if (res.ok && !endedAt) {
      endedAt = att.effectiveAt;
      c.check("STATUS_CHANGE", "PASS", res.detail);
    } else if (!res.ok) {
      c.check("STATUS_CHANGE", "FAIL", res.detail);
      c.reason("STATUS_CHANGE_IGNORED");
    }
  }
  return endedAt;
}

/** E: CONTINUING. ENDED beats freshness; otherwise freshness of the latest finalized ACTIVE epoch decides. */
export function deriveContinuing(
  path: PathAssessment,
  endedAt: Date | null,
  m: SignedMaterial,
  policy: VerificationPolicy,
  now: Date,
  c: Collector,
): LifecycleOutcome & { latestPulse?: AnchorEvidence | null } {
  if (endedAt) {
    c.reason("ENDED");
    return { state: "ENDED", endedAt, evidenceTimestamp: endedAt };
  }
  if (path.status === "NONE") return pendingOutcome(path, m, policy, now, c);
  if (path.status !== "OK") return { state: "INVALID_PROOF" };

  const latest = path.latestActive;
  if (!latest) {
    // Epochs exist but none proves the leaf ACTIVE (e.g. only an unverifiable end): no positive evidence.
    c.check("PULSE_FRESHNESS", "PENDING", "No finalised epoch proves this relationship active.");
    c.reason("AWAITING_ANCHOR");
    return { state: "PENDING" };
  }
  const deadline = new Date(latest.blockTimestamp.getTime() + policy.pulseFreshnessDays * 86_400_000);
  if (now.getTime() <= deadline.getTime()) {
    c.check("PULSE_FRESHNESS", "PASS", "The latest finalised ProofPulse epoch is within the freshness window.");
    c.reason("CURRENT_PULSE");
    return { state: "CURRENTLY_ATTESTED", evidenceTimestamp: latest.blockTimestamp, freshnessDeadline: deadline, latestPulse: latest };
  }
  c.check("PULSE_FRESHNESS", "FAIL", "The latest finalised ProofPulse epoch is older than the freshness window.");
  c.reason("STALE");
  return { state: "STALE_NO_RECENT_ATTESTATION", evidenceTimestamp: latest.blockTimestamp, freshnessDeadline: deadline, latestPulse: latest };
}
