import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { Alert } from "@/components/ui";
import { loginAction } from "@/lib/auth/actions";
import { safeInternalPath } from "@/lib/auth/paths";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  confirmation: "That confirmation link is invalid or has expired. Try signing in, or sign up again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeInternalPath(params.next) ?? undefined;
  const notice = params.error ? NOTICES[params.error] : undefined; // whitelisted text only

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your FARJI account. Candidates, organisation reviewers and administrators all sign in here."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900">
            Create a candidate account
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        {notice ? <Alert tone="error">{notice}</Alert> : null}
        <AuthForm action={loginAction} submitLabel="Sign in" passwordAutoComplete="current-password" next={next} />
      </div>
    </AuthCard>
  );
}
