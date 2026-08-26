"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/credential/StatusBadge";
import { MerkleTreeVisual } from "@/components/merkle/MerkleTreeVisual";
import {
  augustLeaves,
  septemberLeaves,
  augustAttestation,
  septemberAttestation,
} from "@/lib/mock-data/proofPulseDemo";

export function ProofPulseDemoClient() {
  const [employmentEnded, setEmploymentEnded] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MerkleTreeVisual
          title={augustAttestation.label}
          leaves={augustLeaves}
          batchRoot={augustAttestation.batchRoot}
          anchoredAt={augustAttestation.anchoredAt}
          highlightLeafId="PP-B"
        />
        <MerkleTreeVisual
          title={septemberAttestation.label}
          leaves={septemberLeaves}
          batchRoot={septemberAttestation.batchRoot}
          anchoredAt={septemberAttestation.anchoredAt}
        />
      </div>

      <Card>
        <p className="text-sm font-semibold text-slate-500">Credential B — Aarav Sharma, Software Engineer</p>
        <div className="mt-2 flex items-center gap-3">
          <StatusBadge state={employmentEnded ? "ENDED" : "STALE_NO_RECENT_ATTESTATION"} />
        </div>

        {!employmentEnded ? (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Credential B is absent from the September ProofPulse. This means only that{" "}
              <strong>XYZ Technologies Demo has not recently re-attested it as currently active</strong> —
              it does <strong>not</strong> mean employment has ended. Recruiters see{" "}
              <code className="rounded bg-slate-100 px-1">STALE_NO_RECENT_ATTESTATION</code>, never an
              inferred &ldquo;employment ended.&rdquo;
            </p>
            <Button className="mt-4" variant="danger" onClick={() => setEmploymentEnded(true)}>
              End Employment (explicit issuer action)
            </Button>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            The issuer has now explicitly recorded an END event for this credential. Only this
            explicit action moves the state to{" "}
            <code className="rounded bg-slate-100 px-1">ENDED</code> — absence from a ProofPulse batch
            alone never does.
          </p>
        )}
      </Card>
    </div>
  );
}
