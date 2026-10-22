"use client";

import Link from "next/link";
import { btn } from "@/components/ui";
import { LogoMark } from "@/components/ui/Logo";

// Last-resort error boundary: a friendly page, never a stack trace or a raw message. (The server logs the real error.)
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-neutral-600">FARJI could not complete that just now. Nothing was changed. Please try again; if it keeps happening, come back a little later.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className={btn.primary}>
          Try again
        </button>
        <Link href="/" className={btn.secondary}>
          Home
        </Link>
      </div>
    </main>
  );
}
