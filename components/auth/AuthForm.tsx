"use client";

import { useActionState } from "react";
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
    <form action={formAction} className="max-w-sm space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded border border-neutral-300 px-3 py-2"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={passwordAutoComplete}
          required
          minLength={8}
          className="w-full rounded border border-neutral-300 px-3 py-2"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="text-sm text-green-800">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {pending ? "Please wait…" : submitLabel}
      </button>
    </form>
  );
}
