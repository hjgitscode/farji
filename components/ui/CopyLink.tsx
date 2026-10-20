"use client";

import { useState } from "react";
import { btn } from "./index";

/** Copies a link to the clipboard and says so. When the clipboard is unavailable the text is selectable. */
export function CopyLink({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
        <button type="button" onClick={copy} className={btn.secondary}>
          {state === "copied" ? "Copied" : label}
        </button>
      </div>
      {state === "failed" ? (
        <p role="status" className="text-sm text-amber-800">
          Copy is unavailable here. Select the link above and copy it manually.
        </p>
      ) : null}
    </div>
  );
}
