"use client";

import { useFormStatus } from "react-dom";
import { btn, Spinner } from "@/components/ui";

/** A submit button that shows progress while its server action runs, so a slow response never looks like a dead button. */
export function SubmitButton({ children, pendingLabel = "Working…" }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btn.primary}>
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
