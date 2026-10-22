import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { btn } from "@/components/ui";
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
    <AuthCard title="Access denied" icon="lock" description={<span role="alert">{message}</span>}>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className={btn.secondary}>
          Home
        </Link>
        <form action={signOutAction}>
          <button type="submit" className={btn.dark}>
            Sign out
          </button>
        </form>
      </div>
    </AuthCard>
  );
}
