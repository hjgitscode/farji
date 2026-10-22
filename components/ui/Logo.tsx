/** The FARJI mark: a verification shield on the trust green. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="9" fill="#0f5b47" />
      <rect width="32" height="32" rx="9" fill="url(#farji-sheen)" />
      <path d="M16 6.8 8.6 9.7v6c0 4.2 3 7.5 7.4 9.1 4.4-1.6 7.4-4.9 7.4-9.1v-6L16 6.8z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m12.6 15.7 2.5 2.5 4.6-4.9" fill="none" stroke="#7fe0bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="farji-sheen" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Logo({ inverse = false, className = "" }: { inverse?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className={`text-[1.05rem] font-semibold tracking-[0.04em] ${inverse ? "text-white" : "text-neutral-900"}`}>FARJI</span>
    </span>
  );
}
