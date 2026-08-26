"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getCredentialById } from "@/lib/services/candidateService";

export function RevokeCredentialPanel() {
  const [credentialId, setCredentialId] = useState("");
  const [revoked, setRevoked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleRevoke() {
    const credential = getCredentialById(credentialId.trim());
    if (!credential) {
      setError(`No credential found with id "${credentialId}".`);
      return;
    }
    setError(null);
    setRevoked((prev) => (prev.includes(credential.credentialId) ? prev : [...prev, credential.credentialId]));
    setCredentialId("");
  }

  return (
    <Card>
      <p className="font-semibold text-slate-900">Revoke Credential</p>
      <p className="mt-1 text-sm text-slate-500">
        Revocation does not delete history — it marks the credential revoked going forward.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Credential ID, e.g. CRED-005"
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
        />
        <Button variant="danger" onClick={handleRevoke}>
          Revoke
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {revoked.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {revoked.map((id) => (
            <li key={id}>
              <span className="font-mono">{id}</span> marked REVOKED (demo only — resets on reload)
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
