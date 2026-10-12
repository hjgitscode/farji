import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
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
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {notice ? (
        <p role="alert" className="text-sm text-red-700">
          {notice}
        </p>
      ) : null}
      <AuthForm action={loginAction} submitLabel="Sign in" passwordAutoComplete="current-password" next={next} />
      <p className="text-sm text-neutral-700">
        New here?{" "}
        <Link href="/signup" className="underline">
          Create a candidate account
        </Link>
      </p>
    </section>
  );
}
