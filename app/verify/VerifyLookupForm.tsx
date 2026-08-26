"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function VerifyLookupForm() {
  const [credentialId, setCredentialId] = useState("");
  const router = useRouter();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!credentialId.trim()) return;
    router.push(`/verify/${credentialId.trim()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Credential ID, e.g. CRED-002"
        value={credentialId}
        onChange={(e) => setCredentialId(e.target.value)}
      />
      <Button type="submit">Verify</Button>
    </form>
  );
}
