const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  clients: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  membership: "M3 5h18v14H3z M3 10h18 M7 14h4",
  attendance: "M8 2v4 M16 2v4 M3 10h18 M3 4h18v17H3z M8 15l3 3 5-5",
  products: "m12 3 9 5-9 5-9-5 9-5 M3 8v10l9 5 9-5V8 M12 13v10",
  expenses: "M4 3h16v18l-4-2-4 2-4-2-4 2V3 M8 8h8 M8 12h8",
  reports: "M4 3v18h17 M8 16v-4 M13 16V8 M18 16V5",
  payments: "M3 6h18v12H3z M3 10h18 M7 15h4",
  wod: "M5 3v18 M19 3v18 M2 8h6 M16 8h6 M8 6v4 M16 6v4 M8 17h8",
  announcements: "M3 11v2 M6 9l10-4v14L6 15z M6 15l2 6h4l-2-7 M19 9a4 4 0 0 1 0 6",
  privacy: "M12 3 19 6v5c0 4.6-2.8 8.1-7 10-4.2-1.9-7-5.4-7-10V6z M9 12l2 2 4-4",
  users: "M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v1 M8.5 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8v6 M15 11h6",
  plus: "M12 5v14 M5 12h14",
} as const;

export type PortalIconName = keyof typeof paths;
export default function PortalIcon({ name }: { name: PortalIconName }) {
  return <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
