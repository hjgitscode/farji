import type { Metadata } from "next";
import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Access denied" };

// Fixed messages chosen by a whitelisted reason code; nothing from the URL is echoed.
const MESSAGES: Record<string, string> = {
  default: "You do not have access to that area.",
  disabled: "This account is not currently active.",
  organisation_inactive: "Your organisation is not currently active, so reviewer access is unavailable. Contact an administrator.",
  organisation: "Your reviewer account is not linked to an organisation yet. Contact an administrator.",
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = (reason && Object.hasOwn(MESSAGES, reason) ? MESSAGES[reason] : undefined) ?? MESSAGES.default;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p role="alert" className="text-neutral-700">
        {message}
      </p>
      <div className="flex gap-4 text-sm">
        <Link href="/" className="underline">
          Home
        </Link>
        <form action={signOutAction}>
          <button type="submit" className="underline">
            Sign out
          </button>
        </form>
      </div>
    </section>
  );
}
