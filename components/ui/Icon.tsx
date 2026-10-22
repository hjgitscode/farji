// One outline icon set (24px grid, 1.75 stroke). Decorative: always aria-hidden; meaning is carried by adjacent text.

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const PATHS = {
  check: ["M20 6 9 17l-5-5"],
  "shield-check": ["M12 3 4.5 6v5.5c0 4.4 3.1 7.6 7.5 9 4.4-1.4 7.5-4.6 7.5-9V6L12 3z", "m9 12 2 2 4-4"],
  alert: ["M12 3.5 2.8 19.5h18.4L12 3.5z", "M12 10v4", "M12 17h.01"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  clock: [circle(12, 12, 9), "M12 7v5l3 2"],
  circle: [circle(12, 12, 8.5)],
  dot: [circle(12, 12, 3)],
  ellipsis: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  home: ["M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z"],
  grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  users: ["M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1", "M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M21 20v-1a4 4 0 0 0-3-3.9", "M15 4.1a3.5 3.5 0 0 1 0 6.8"],
  user: ["M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  building: ["M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16", "M15 9h4a1 1 0 0 1 1 1v11", "M2 21h20", "M8 8h3", "M8 12h3", "M8 16h3"],
  wallet: ["M3 7a2 2 0 0 1 2-2h13v4", "M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z", "M16 14.5h.01"],
  layers: ["m12 3 9 5-9 5-9-5 9-5z", "m3 13 9 5 9-5"],
  activity: ["M3 12h4l3 8 4-16 3 8h4"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  search: [circle(11, 11, 7), "m20 20-3.5-3.5"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  key: [circle(8, 15, 4), "m10.8 12.2 9.7-9.7", "m17 6 3 3"],
  history: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5", "M12 7v5l3 2"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-right": ["m9 6 6 6-6 6"],
  "arrow-right": ["M5 12h14", "m13 6 6 6-6 6"],
  external: ["M14 4h6v6", "M20 4 10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  inbox: ["M3 13h5l1 3h6l1-3h5", "M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2.5-8z"],
  pen: ["M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z", "m13.5 6.5 4 4"],
  anchor: [circle(12, 5, 2), "M12 7v14", "M5 12H3a9 9 0 0 0 18 0h-2"],
  refresh: ["M20 11a8 8 0 0 0-14.5-4", "M4 4v4h4", "M4 13a8 8 0 0 0 14.5 4", "M20 20v-4h-4"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  logout: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "m10 17 5-5-5-5", "M15 12H4"],
  share: ["M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7", "M12 3v13", "m7 8 5-5 5 5"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", circle(12, 12, 3)],
  plus: ["M12 5v14", "M5 12h14"],
  globe: [circle(12, 12, 9), "M3 12h18", "M12 3a14 14 0 0 1 0 18", "M12 3a14 14 0 0 0 0 18"],
  copy: ["M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  lock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V8a4 4 0 0 1 8 0v3"],
  briefcase: ["M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8z", "M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2", "M3 13h18"],
  graduation: ["m12 4 10 5-10 5L2 9l10-5z", "M6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5", "M22 9v6"],
  award: [circle(12, 9, 6), "m8.5 14-1.5 7 5-3 5 3-1.5-7"],
  badge: ["M12 3l2.4 1.8 3-.1.9 2.9 2.4 1.8-.9 2.9.9 2.9-2.4 1.8-.9 2.9-3-.1L12 21l-2.4-1.8-3 .1-.9-2.9L3.3 14.6l.9-2.9-.9-2.9 2.4-1.8.9-2.9 3 .1L12 3z", "m9 12 2 2 4-4"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-4", strokeWidth = 1.75 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}
