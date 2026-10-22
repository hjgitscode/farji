import { Icon } from "@/components/ui";

// Small diagrams that show how FARJI proves a batch of credentials (CohortProof) and keeps ongoing relationships fresh (ProofPulse).
// Illustration only: example labels, no live data, no claims about any real record.

const box = "fill-white stroke-neutral-300";
const label = "fill-neutral-700 font-sans";

function Step({ n, title, caption, children }: { n: number; title: string; caption: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col rounded-md border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-neutral-900 text-[0.65rem] font-semibold text-white">{n}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="flex flex-1 items-center justify-center bg-neutral-50 px-2 py-3">{children}</div>
      <p className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-600">{caption}</p>
    </li>
  );
}

function Doc({ x, y, on = false }: { x: number; y: number; on?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width="30" height="38" rx="3" className={on ? "fill-emerald-50 stroke-emerald-600" : box} />
      <path d={`M${x + 6} ${y + 12}h18M${x + 6} ${y + 19}h18M${x + 6} ${y + 26}h10`} className="stroke-neutral-400" strokeWidth="1.5" strokeLinecap="round" />
      <path d={`m${x + 19} ${y + 28} 3 3 5-6`} className="stroke-emerald-600" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** CohortProof: signed records -> Merkle root (off-chain) -> anchored on-chain -> checked publicly. */
export function CohortExplainer() {
  return (
    <section aria-label="How a batch is proven" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">How a batch is proven</h2>
        <p className="text-xs text-neutral-500">Example batch of four records</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Step n={1} title="Sign" caption="Each record is signed by your wallet.">
          <svg viewBox="0 0 170 50" className="h-24 w-full max-w-[220px]" role="img" aria-label="Four signed records">
            <Doc x={4} y={6} />
            <Doc x={44} y={6} on />
            <Doc x={84} y={6} />
            <Doc x={124} y={6} />
          </svg>
        </Step>

        <Step n={2} title="Batch" caption="Records are hashed into one Merkle root, off-chain.">
          <svg viewBox="0 0 200 118" className="h-24 w-full max-w-[220px]" role="img" aria-label="A Merkle tree of four records with one root">
            <g className="stroke-neutral-300" strokeWidth="1.2" fill="none">
              <path d="M100 30 50 54M100 30 150 54M50 70 25 94M50 70 75 94M150 70 125 94M150 70 175 94" />
            </g>
            <path d="M100 30 50 54M50 70 75 94" className="stroke-emerald-600" strokeWidth="2" fill="none" />
            <rect x="72" y="8" width="56" height="22" rx="4" className="fill-emerald-700" />
            <text x="100" y="23" textAnchor="middle" fontSize="10" className="fill-white font-sans" fontWeight="600">
              Root
            </text>
            <rect x="30" y="54" width="40" height="16" rx="3" className="fill-emerald-50 stroke-emerald-600" />
            <rect x="130" y="54" width="40" height="16" rx="3" className="fill-amber-50 stroke-amber-500" />
            {[25, 75, 125, 175].map((x, i) => (
              <g key={x}>
                <rect x={x - 17} y="94" width="34" height="16" rx="3" className={i === 1 ? "fill-emerald-50 stroke-emerald-600" : i === 0 ? "fill-amber-50 stroke-amber-500" : box} />
                <text x={x} y="105.5" textAnchor="middle" fontSize="8" className={label}>
                  R{i + 1}
                </text>
              </g>
            ))}
          </svg>
        </Step>

        <Step n={3} title="Anchor" caption="Only the root goes on-chain. No record content.">
          <svg viewBox="0 0 200 60" className="h-24 w-full max-w-[220px]" role="img" aria-label="A chain of blocks with the latest holding the root">
            {[8, 74, 140].map((x, i) => (
              <g key={x}>
                <rect x={x} y="10" width="52" height="40" rx="5" className={i === 2 ? "fill-emerald-700" : box} />
                <text x={x + 26} y="28" textAnchor="middle" fontSize="8" className={i === 2 ? "fill-emerald-100 font-sans" : label}>
                  {i === 2 ? "Root" : "Block"}
                </text>
                <text x={x + 26} y="41" textAnchor="middle" fontSize="7" className={i === 2 ? "fill-white font-mono" : "fill-neutral-400 font-mono"}>
                  {i === 2 ? "0x938c…" : "0x…"}
                </text>
                {i < 2 ? <path d={`M${x + 52} 30h14`} className="stroke-neutral-400" strokeWidth="1.5" /> : null}
              </g>
            ))}
          </svg>
        </Step>

        <Step n={4} title="Check" caption="Anyone can recompute the root from a record and its proof.">
          <svg viewBox="0 0 200 60" className="h-24 w-full max-w-[220px]" role="img" aria-label="A record plus its proof recompute the anchored root">
            <rect x="4" y="18" width="36" height="24" rx="4" className="fill-emerald-50 stroke-emerald-600" />
            <text x="22" y="33" textAnchor="middle" fontSize="8" className={label}>
              Record
            </text>
            <text x="52" y="34" fontSize="12" className="fill-neutral-400 font-sans">
              +
            </text>
            <rect x="64" y="18" width="36" height="24" rx="4" className="fill-amber-50 stroke-amber-500" />
            <text x="82" y="33" textAnchor="middle" fontSize="8" className={label}>
              Proof
            </text>
            <text x="108" y="34" fontSize="12" className="fill-neutral-400 font-sans">
              =
            </text>
            <rect x="122" y="18" width="40" height="24" rx="4" className="fill-emerald-700" />
            <text x="142" y="33" textAnchor="middle" fontSize="8" className="fill-white font-sans" fontWeight="600">
              Root
            </text>
            <circle cx="182" cy="30" r="9" className="fill-emerald-600" />
            <path d="m177.5 30 3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Step>
      </ol>
    </section>
  );
}

/** ProofPulse: an ongoing relationship is current only while it keeps being re-confirmed. */
export function PulseExplainer() {
  // x positions on a 0-100 month axis (viewBox 0 0 640 130)
  const x = (m: number) => 40 + m * 92;
  return (
    <section aria-label="How current relationships stay fresh" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">How a current relationship stays fresh</h2>
        <p className="text-xs text-neutral-500">Example: 45-day freshness window</p>
      </div>
      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white p-3">
        <svg viewBox="0 0 640 130" className="mx-auto min-w-[520px] w-full max-w-[640px]" role="img" aria-label="A timeline: confirmed, fresh for 45 days, needs refresh, confirmed again, then ended">
          {["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m, i) => (
            <g key={m}>
              <path d={`M${x(i)} 62v10`} className="stroke-neutral-300" />
              <text x={x(i)} y="88" textAnchor="middle" fontSize="11" className="fill-neutral-500 font-sans">
                {m}
              </text>
            </g>
          ))}
          <rect x={x(0)} y="40" width={x(1.5) - x(0)} height="18" rx="3" className="fill-teal-600" />
          <rect x={x(1.5)} y="40" width={x(2.6) - x(1.5)} height="18" rx="3" className="fill-amber-400" />
          <rect x={x(2.6)} y="40" width={x(4.1) - x(2.6)} height="18" rx="3" className="fill-teal-600" />
          <rect x={x(4.1)} y="40" width={x(5) - x(4.1)} height="18" rx="3" className="fill-neutral-400" />
          {[
            [0, "Confirmed"],
            [2.6, "Confirmed again"],
            [4.1, "Role ended"],
          ].map(([m, t]) => (
            <g key={t as string}>
              <circle cx={x(m as number)} cy="49" r="7" className="fill-white stroke-neutral-900" strokeWidth="2" />
              <text x={x(m as number)} y="26" textAnchor="middle" fontSize="11" className="fill-neutral-800 font-sans" fontWeight="600">
                {t}
              </text>
            </g>
          ))}
          <g fontSize="11" className="font-sans">
            <rect x="40" y="104" width="10" height="10" rx="2" className="fill-teal-600" />
            <text x="56" y="113" className="fill-neutral-700">
              Currently confirmed
            </text>
            <rect x="190" y="104" width="10" height="10" rx="2" className="fill-amber-400" />
            <text x="206" y="113" className="fill-neutral-700">
              Needs refresh (no recent confirmation)
            </text>
            <rect x="440" y="104" width="10" height="10" rx="2" className="fill-neutral-400" />
            <text x="456" y="113" className="fill-neutral-700">
              Ended (not a revocation)
            </text>
          </g>
        </svg>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
          <Icon name="anchor" className="size-3.5" />
          Each confirmation updates one leaf and is anchored; time passing alone never changes a record.
        </p>
      </div>
    </section>
  );
}
