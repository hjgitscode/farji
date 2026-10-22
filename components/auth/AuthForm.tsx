"use client";

import { useActionState } from "react";
import { btn, Icon, inputClass, Spinner } from "@/components/ui";
import type { AuthFormState } from "@/lib/auth/actions";

type Props = {
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
  /** Optional validated return path, forwarded to the server action (which re-validates it). */
  next?: string;
};

export function AuthForm({ action, submitLabel, passwordAutoComplete, next }: Props) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-neutral-800">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" className={`${inputClass} py-2.5`} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-neutral-800">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete={passwordAutoComplete} required minLength={8} className={`${inputClass} py-2.5`} />
        {passwordAutoComplete === "new-password" ? <p className="text-xs text-neutral-500">At least 8 characters.</p> : null}
      </div>

      {state.error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <Icon name="alert" className="mt-0.5 size-4" strokeWidth={2.25} />
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Icon name="check" className="mt-0.5 size-4" strokeWidth={2.25} />
          {state.message}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${btn.primary} w-full py-2.5`}>
        {pending ? (
          <>
            <Spinner />
            Please wait…
          </>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  );
}
