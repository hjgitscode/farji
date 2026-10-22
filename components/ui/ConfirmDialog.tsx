"use client";

import { useRef } from "react";
import { btn } from "./index";

/**
 * A button that asks for confirmation in a modal dialog before running `onConfirm`. Destructive actions use
 * `tone="danger"`. Uses the native dialog element, which provides focus handling and Escape-to-cancel.
 */
export function ConfirmDialog({
  trigger,
  title,
  body,
  confirmLabel,
  tone = "primary",
  onConfirm,
  disabled,
}: {
  trigger: string;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => ref.current?.showModal()} className={tone === "danger" ? btn.danger : btn.secondary}>
        {trigger}
      </button>
      <dialog ref={ref} aria-label={title} className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-neutral-200 p-0 shadow-xl backdrop:bg-black/40">
        <div className="space-y-3 p-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="text-sm text-neutral-700">{body}</div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={btn.secondary} onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button
              type="button"
              className={tone === "danger" ? btn.danger : btn.primary}
              onClick={() => {
                ref.current?.close();
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
