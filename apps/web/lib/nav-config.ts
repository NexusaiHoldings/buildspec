/**
 * Top Navigation Configuration — substrate-topnav-001 (2026-05-24).
 *
 * Hotfix 2026-06-01 — F1-001's agent never committed nav config; populated
 * manually after deploy. Tracks against deployed routes in apps/web/app/(specdraft)/.
 */

export type NavLink = {
  href: string;
  label: string;
};

export type NavGroup = {
  label: string;
  links: NavLink[];
};

export type NavConfig = {
  primary: NavLink[];
  groups: NavGroup[];
};

export const NAV_CONFIG: NavConfig = {
  primary: [
    { href: "/", label: "Home" },
    { href: "/projects", label: "Projects" },
    { href: "/projects/new", label: "New Project" },
  ],
  groups: [],
};
