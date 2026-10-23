import { Icon } from "@/components/ui";

// Product visualisations that explain CohortProof and ProofPulse with two concrete examples. Illustration only: the names and numbers
// are examples, no live data is read, and nothing here makes a claim about any real record.

const FONT = "font-sans";

function Person({ x, y, on = false }: { x: number; y: number; on?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(1.2)`} className={on ? "fill-emerald-600" : "fill-neutral-300"}>
      <circle cx="0" cy="-3" r="2.6" />
      <path d="M-4.2 6a4.2 4.2 0 0 1 8.4 0z" />
      {on ? <circle cx="0" cy="1" r="9" className="fill-none stroke-emerald-600" strokeWidth="1.5" /> : null}
    </g>
  );
}

function Doc({ x, y, on = false }: { x: number; y: number; on?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width="54" height="66" rx="4" className={on ? "fill-emerald-50 stroke-emerald-600" : "fill-white stroke-neutral-300"} />
      <path d={`M${x + 10} ${y + 16}h34M${x + 10} ${y + 26}h34M${x + 10} ${y + 36}h20`} className="stroke-neutral-300" strokeWidth="2" strokeLinecap="round" />
      <path d={`m${x + 31} ${y + 50} 5 5 9-10`} className="stroke-emerald-600" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, className = "stroke-neutral-400" }: { x1: number; y1: number; x2: number; y2: number; className?: string }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = (d: number) => `${x2 - 8 * Math.cos(a - d)},${y2 - 8 * Math.sin(a - d)}`;
  return (
    <g className={className} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x1} ${y1}L${x2} ${y2}`} />
      <path d={`M${h(0.45)}L${x2} ${y2}L${h(-0.45)}`} />
    </g>
  );
}

function Chip({ x, y, w, h = 30, text, tone }: { x: number; y: number; w: number; h?: number; text: string; tone: "ok" | "proof" | "root" | "plain" }) {
  const cls = { ok: "fill-emerald-50 stroke-emerald-600", proof: "fill-amber-50 stroke-amber-500", root: "fill-emerald-700 stroke-emerald-700", plain: "fill-white stroke-neutral-300" }[tone];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="5" className={cls} />
      <text x={x + w / 2} y={y + h / 2 + 4.5} textAnchor="middle" fontSize="12" fontWeight="600" className={`${tone === "root" ? "fill-white" : "fill-neutral-800"} ${FONT}`}>
        {text}
      </text>
    </g>
  );
}

function ExampleHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 sm:px-5">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <p className="text-xs text-neutral-500">{sub}</p>
      </div>
      <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">Example</span>
    </div>
  );
}

/** CohortProof: a graduating class becomes one Merkle root on-chain, and one student can still prove inclusion. */
export function CohortExplainer() {
  const leaves = Array.from({ length: 8 }, (_, i) => 358 + i * 36);
  const l2 = [376, 448, 520, 592];
  const l3 = [412, 556];
  return (
    <section aria-label="CohortProof example" className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <ExampleHeader title="CohortProof · VIT Chennai, Class of 2026" sub="100 students graduate. 100 signed degrees. One root on-chain." />
      <div className="overflow-x-auto p-3 sm:p-4">
        <svg viewBox="0 0 960 384" className="mx-auto w-full min-w-[820px] max-w-[1040px]" role="img" aria-label="100 students become 100 signed credentials, then a Merkle tree computed off-chain, then one Merkle root anchored on Sepolia. One student's proof path is highlighted.">
          {/* zones */}
          <rect x="10" y="12" width="650" height="252" rx="8" className="fill-neutral-50 stroke-neutral-300" strokeDasharray="5 4" />
          <text x="26" y="34" fontSize="11" fontWeight="700" letterSpacing="1.2" className={`fill-neutral-500 ${FONT}`}>
            OFF-CHAIN · credential hashes + Merkle tree
          </text>
          <rect x="676" y="12" width="274" height="252" rx="8" className="fill-emerald-50 stroke-emerald-600" />
          <text x="692" y="34" fontSize="11" fontWeight="700" letterSpacing="1.2" className={`fill-emerald-800 ${FONT}`}>
            ON-CHAIN · Merkle root only
          </text>

          {/* students */}
          {Array.from({ length: 100 }, (_, i) => (
            <Person key={i} x={38 + (i % 10) * 15} y={76 + Math.floor(i / 10) * 15} on={i === 37} />
          ))}
          <text x="112" y="240" textAnchor="middle" fontSize="13" fontWeight="600" className={`fill-neutral-800 ${FONT}`}>
            100 students
          </text>
          <Arrow x1={190} y1={128} x2={218} y2={128} />

          {/* credentials */}
          <Doc x={232} y={92} />
          <Doc x={242} y={102} />
          <Doc x={252} y={112} on />
          <text x="282" y="224" textAnchor="middle" fontSize="13" fontWeight="600" className={`fill-neutral-800 ${FONT}`}>
            100 signed
          </text>
          <text x="282" y="240" textAnchor="middle" fontSize="13" fontWeight="600" className={`fill-neutral-800 ${FONT}`}>
            degrees
          </text>
          <Arrow x1={324} y1={128} x2={346} y2={128} />

          {/* merkle tree */}
          <g className="stroke-neutral-300" strokeWidth="1.4" fill="none">
            {leaves.map((x, i) => (
              <path key={i} d={`M${x + 12} 190L${l2[Math.floor(i / 2)]} 178`} />
            ))}
            {l2.map((x, i) => (
              <path key={i} d={`M${x} 160L${l3[Math.floor(i / 2)]} 148`} />
            ))}
            {l3.map((x, i) => (
              <path key={i} d={`M${x} 130L484 114`} />
            ))}
          </g>
          <g className="stroke-emerald-600" strokeWidth="2.6" fill="none">
            <path d={`M${leaves[2] + 12} 190L${l2[1]} 178M${l2[1]} 160L${l3[0]} 148M${l3[0]} 130L484 114`} />
          </g>
          {[l3[0], l3[1]].map((x, i) => (
            <rect key={x} x={x - 17} y="130" width="34" height="18" rx="4" className={i === 0 ? "fill-emerald-100 stroke-emerald-600" : "fill-amber-50 stroke-amber-500"} />
          ))}
          {l2.map((x, i) => (
            <rect key={x} x={x - 15} y="160" width="30" height="18" rx="4" className={i === 1 ? "fill-emerald-100 stroke-emerald-600" : i === 0 ? "fill-amber-50 stroke-amber-500" : "fill-white stroke-neutral-300"} />
          ))}
          {leaves.map((x, i) => (
            <rect key={x} x={x} y="190" width="24" height="18" rx="4" className={i === 2 ? "fill-emerald-600 stroke-emerald-600" : i === 3 ? "fill-amber-50 stroke-amber-500" : "fill-white stroke-neutral-300"} />
          ))}
          <rect x="460" y="96" width="48" height="22" rx="5" className="fill-emerald-700" />
          <text x="484" y="111.5" textAnchor="middle" fontSize="12" fontWeight="700" className={`fill-white ${FONT}`}>
            Root
          </text>
          <text x="484" y="240" textAnchor="middle" fontSize="13" fontWeight="600" className={`fill-neutral-800 ${FONT}`}>
            Merkle tree of 100 hashes
          </text>
          <text x="484" y="256" textAnchor="middle" fontSize="11" className={`fill-neutral-500 ${FONT}`}>
            computed off-chain
          </text>

          {/* anchor */}
          <Arrow x1={512} y1={107} x2={704} y2={107} className="stroke-emerald-700" />
          <text x="608" y="98" textAnchor="middle" fontSize="11" fontWeight="600" className={`fill-emerald-800 ${FONT}`}>
            only the root
          </text>
          <rect x="716" y="76" width="210" height="52" rx="6" className="fill-emerald-700" />
          <text x="821" y="98" textAnchor="middle" fontSize="12" fontWeight="600" className={`fill-emerald-100 ${FONT}`}>
            Merkle root
          </text>
          <text x="821" y="116" textAnchor="middle" fontSize="12" className="fill-white font-mono">
            0x938c…e7775c
          </text>
          <Arrow x1={821} y1={130} x2={821} y2={158} className="stroke-emerald-700" />
          <rect x="716" y="162" width="210" height="62" rx="6" className="fill-white stroke-emerald-600" strokeWidth="1.6" />
          <circle cx="744" cy="193" r="11" className="fill-emerald-600" />
          <path d="m738.5 193 4 4 7-8" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x="764" y="189" fontSize="13" fontWeight="700" className={`fill-neutral-900 ${FONT}`}>
            Anchored on Sepolia
          </text>
          <text x="764" y="207" fontSize="12" className={`fill-emerald-800 ${FONT}`}>
            Finalized
          </text>

          {/* proof strip */}
          <rect x="10" y="284" width="940" height="92" rx="8" className="fill-white stroke-neutral-300" />
          <text x="26" y="308" fontSize="11" fontWeight="700" letterSpacing="1.2" className={`fill-neutral-500 ${FONT}`}>
            ONE STUDENT PROVES INCLUSION · no other student is revealed
          </text>
          <Chip x={26} y={324} w={158} text="Student #37's degree" tone="ok" />
          <text x="190" y="344" textAnchor="middle" fontSize="16" className={`fill-neutral-400 ${FONT}`}>
            +
          </text>
          <Chip x={206} y={324} w={46} text="h₁" tone="proof" />
          <Chip x={260} y={324} w={46} text="h₂" tone="proof" />
          <Chip x={314} y={324} w={46} text="h₃" tone="proof" />
          <text x="378" y="345" textAnchor="middle" fontSize="14" className={`fill-neutral-400 ${FONT}`}>
            …
          </text>
          <Chip x={396} y={324} w={46} text="h₇" tone="proof" />
          <text x="462" y="344" textAnchor="middle" fontSize="16" className={`fill-neutral-400 ${FONT}`}>
            =
          </text>
          <Chip x={482} y={324} w={74} text="Root" tone="root" />
          <Arrow x1={564} y1={339} x2={606} y2={339} className="stroke-emerald-700" />
          <circle cx="628" cy="339" r="11" className="fill-emerald-600" />
          <path d="m622.5 339 4 4 7-8" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x="648" y="344" fontSize="13" fontWeight="600" className={`fill-neutral-900 ${FONT}`}>
            matches the root on-chain
          </text>
        </svg>
      </div>
    </section>
  );
}

type LeafState = "current" | "ended" | "new" | "same";

function MiniTree({ leaves, changed, rootLabel, rootNew }: { leaves: { label: string; state: LeafState }[]; changed: boolean[]; rootLabel: string; rootNew: boolean }) {
  const xs = [30, 80, 130, 180];
  const leafCls = (s: LeafState) => (s === "current" ? "fill-emerald-50 stroke-emerald-600" : s === "ended" ? "fill-neutral-200 stroke-neutral-400" : s === "new" ? "fill-amber-100 stroke-amber-500" : "fill-white stroke-neutral-300");
  const ed = (on: boolean) => (on ? "stroke-amber-500" : "stroke-neutral-300");
  return (
    <svg viewBox="0 0 210 132" className="mx-auto w-full max-w-[250px]" role="img" aria-label={`Four employee leaves under one root ${rootLabel}`}>
      <g fill="none" strokeWidth="1.6">
        <path d="M30 98L55 66" className={ed(changed[0])} />
        <path d="M80 98L55 66" className={ed(changed[1])} />
        <path d="M130 98L155 66" className={ed(changed[2])} />
        <path d="M180 98L155 66" className={ed(changed[3])} />
        <path d="M55 66L105 36" className={ed(changed[0] || changed[1])} />
        <path d="M155 66L105 36" className={ed(changed[2] || changed[3])} />
      </g>
      <rect x="40" y="56" width="30" height="16" rx="4" className={changed[0] || changed[1] ? "fill-amber-50 stroke-amber-500" : "fill-white stroke-neutral-300"} />
      <rect x="140" y="56" width="30" height="16" rx="4" className={changed[2] || changed[3] ? "fill-amber-50 stroke-amber-500" : "fill-white stroke-neutral-300"} />
      {leaves.map((l, i) => (
        <g key={l.label}>
          <rect x={xs[i] - 17} y="98" width="34" height="22" rx="5" className={leafCls(l.state)} strokeDasharray={l.state === "same" ? "3 3" : undefined} />
          <text x={xs[i]} y="113" textAnchor="middle" fontSize="12" fontWeight="700" className={`${l.state === "ended" ? "fill-neutral-500" : "fill-neutral-800"} ${FONT}`} textDecoration={l.state === "ended" ? "line-through" : undefined}>
            {l.label}
          </text>
        </g>
      ))}
      <rect x="77" y="12" width="56" height="24" rx="5" className={rootNew ? "fill-emerald-700" : "fill-white stroke-neutral-300"} strokeDasharray={rootNew ? undefined : "4 3"} />
      <text x="105" y="28" textAnchor="middle" fontSize="12" fontWeight="700" className={`${rootNew ? "fill-white" : "fill-neutral-400"} ${FONT}`}>
        {rootLabel}
      </text>
    </svg>
  );
}

function MonthCard({ month, headline, children, tag, tagTone }: { month: string; headline: string; children: React.ReactNode; tag: string; tagTone: "ok" | "none" }) {
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-4 py-2.5">
        <p className="text-sm font-semibold">{month}</p>
        <p className="text-xs text-neutral-500">{headline}</p>
      </div>
      <div className="flex-1 space-y-3 p-4">{children}</div>
      <div className={`flex items-center gap-2 border-t px-4 py-2.5 text-xs font-semibold ${tagTone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-neutral-200 bg-neutral-50 text-neutral-500"}`}>
        <span className="text-[0.65rem] tracking-[0.12em]">{tagTone === "ok" ? "ON-CHAIN" : "NOTHING SENT"}</span>
        <span className="font-medium">{tag}</span>
      </div>
    </li>
  );
}

function Pill({ name, state }: { name: string; state: "current" | "ended" | "joined" }) {
  const cls = state === "current" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : state === "joined" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-neutral-300 bg-neutral-100 text-neutral-500";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${cls}`}>
      <Icon name="user" className="size-3.5" />
      <span className={state === "ended" ? "line-through" : ""}>{name}</span>
      <span className="font-normal">{state === "current" ? "current" : state === "ended" ? "ended" : "joined"}</span>
    </span>
  );
}

/** ProofPulse: only a change of state produces a new root. */
export function PulseExplainer() {
  return (
    <section aria-label="ProofPulse example" className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <ExampleHeader title="ProofPulse · ExampleCo, 500 employees" sub="Current employment is re-confirmed by events, not by the calendar." />
      <div className="space-y-4 p-4 sm:p-5">
        <ol className="grid gap-3 lg:grid-cols-3">
          <MonthCard month="January" headline="500 employees, all current" tag="Root 1 anchored" tagTone="ok">
            <div className="flex flex-wrap gap-1.5">
              <Pill name="A" state="current" />
              <Pill name="B" state="current" />
              <Pill name="C" state="current" />
              <span className="self-center text-xs text-neutral-500">+ 497</span>
            </div>
            <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-2">
              <p className="px-1 text-[0.65rem] font-bold tracking-[0.12em] text-neutral-500">OFF-CHAIN · state tree</p>
              <MiniTree leaves={[{ label: "A", state: "current" }, { label: "B", state: "current" }, { label: "C", state: "current" }, { label: "…", state: "same" }]} changed={[false, false, false, false]} rootLabel="Root 1" rootNew />
            </div>
          </MonthCard>

          <MonthCard month="February" headline="Time passes. Nothing changes." tag="no new root" tagTone="none">
            <div className="flex flex-wrap gap-1.5">
              <Pill name="A" state="current" />
              <Pill name="B" state="current" />
              <Pill name="C" state="current" />
              <span className="self-center text-xs text-neutral-500">+ 497</span>
            </div>
            <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-2">
              <p className="px-1 text-[0.65rem] font-bold tracking-[0.12em] text-neutral-500">OFF-CHAIN · state tree</p>
              <MiniTree leaves={[{ label: "A", state: "same" }, { label: "B", state: "same" }, { label: "C", state: "same" }, { label: "…", state: "same" }]} changed={[false, false, false, false]} rootLabel="Root 1" rootNew={false} />
            </div>
          </MonthCard>

          <MonthCard month="March" headline="C leaves. D joins. A and B unchanged." tag="Root 2 anchored" tagTone="ok">
            <div className="flex flex-wrap gap-1.5">
              <Pill name="A" state="current" />
              <Pill name="B" state="current" />
              <Pill name="C" state="ended" />
              <Pill name="D" state="joined" />
            </div>
            <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-2">
              <p className="px-1 text-[0.65rem] font-bold tracking-[0.12em] text-neutral-500">OFF-CHAIN · only affected branches update</p>
              <MiniTree leaves={[{ label: "A", state: "current" }, { label: "B", state: "current" }, { label: "C", state: "ended" }, { label: "D", state: "new" }]} changed={[false, false, true, true]} rootLabel="Root 2" rootNew />
            </div>
          </MonthCard>
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-900">
            <span className="text-[0.65rem] font-bold tracking-[0.12em]">ON-CHAIN · root history</span>
            <span className="rounded-md bg-emerald-700 px-2.5 py-1 text-white">Root 1</span>
            <Icon name="arrow-right" className="size-4" />
            <span className="rounded-md bg-emerald-700 px-2.5 py-1 text-white">Root 2</span>
            <span className="text-xs font-medium text-emerald-800">each root links to the one before it</span>
          </div>
          <p className="text-sm font-medium text-neutral-800">ProofPulse is event-driven. Time passing alone does not create a new root.</p>
        </div>
      </div>
    </section>
  );
}

/** This batch, drawn from its real credential count: n signed credentials become n leaves under one Merkle root. */
export function BatchLeaves({ count, root }: { count: number; root: string | null }) {
  const n = Math.max(1, Math.min(count, 12));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5" role="img" aria-label={`${count} credentials form ${count} leaves under one Merkle root`}>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="flex h-7 w-6 items-center justify-center rounded-sm border border-emerald-600 bg-emerald-50 text-emerald-700">
            <Icon name="check" className="size-3.5" strokeWidth={2.75} />
          </span>
        ))}
        {count > n ? <span className="text-xs text-neutral-500">+{count - n}</span> : null}
      </div>
      <span className="text-xs font-medium text-neutral-500">
        {count} leaf{count === 1 ? "" : "s"} <Icon name="arrow-right" className="mx-1 inline size-3.5" /> off-chain Merkle tree <Icon name="arrow-right" className="mx-1 inline size-3.5" />
      </span>
      <span className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">{root ? `Root ${root.slice(0, 8)}…${root.slice(-4)}` : "Root (when closed)"}</span>
    </div>
  );
}
