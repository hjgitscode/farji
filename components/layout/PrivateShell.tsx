import { PageShell } from "./PageShell";

/** Shell for private areas. Intentionally exposes no cross-role navigation. */
export function PrivateShell({ children }: { children: React.ReactNode }) {
  return <PageShell nav={[]}>{children}</PageShell>;
}
