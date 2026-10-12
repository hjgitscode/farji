import { signOutAction } from "@/lib/auth/actions";
import { PageShell } from "./PageShell";

/** Shell for private areas: no cross-role navigation, just sign-out. */
export function PrivateShell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell nav={[]}>
      <form action={signOutAction} className="mb-6 flex justify-end">
        <button type="submit" className="text-sm underline">
          Sign out
        </button>
      </form>
      {children}
    </PageShell>
  );
}
