export type NavSection = {
  id: string;
  label: string;
  href: string;
  match: (p: string) => boolean;
  subNav?: Array<{ href: string; label: string; match: (p: string) => boolean }>;
};

export const mainSections: NavSection[] = [
  {
    id: "home",
    label: "Home",
    href: "/",
    match: (p) => p === "/",
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    match: (p) => p.startsWith("/analytics"),
    subNav: [
      { href: "/analytics", label: "Yearly Lab", match: (p) => p === "/analytics" },
      { href: "/analytics/summary", label: "Path Summary", match: (p) => p.startsWith("/analytics/summary") },
    ],
  },
  {
    id: "desk",
    label: "Desk",
    href: "/product",
    match: (p) => ["/product", "/paths", "/hedging", "/computation"].some((x) => p.startsWith(x)),
    subNav: [
      { href: "/product", label: "Product", match: (p) => p.startsWith("/product") },
      { href: "/paths", label: "Paths", match: (p) => p.startsWith("/paths") },
      { href: "/hedging", label: "Hedging Sheet", match: (p) => p.startsWith("/hedging") },
      { href: "/computation", label: "Computation", match: (p) => p === "/computation" },
      { href: "/computation/ledger", label: "Daily Ledger", match: (p) => p.startsWith("/computation/ledger") },
    ],
  },
  {
    id: "intel",
    label: "Intel",
    href: "/intel",
    match: (p) => p.startsWith("/intel"),
    subNav: [
      { href: "/intel", label: "Path Market", match: (p) => p === "/intel" },
      { href: "/intel/logic", label: "Logic Atlas", match: (p) => p.startsWith("/intel/logic") },
    ],
  },
];

export function resolveNav(pathname: string) {
  return mainSections.find((s) => s.match(pathname)) ?? mainSections[0];
}
