/**
 * Footer — site footer with standard legal links (legal-surface-mount-001).
 *
 * Server component. Links to the legal pages mounted from the
 * @nexus/legal-and-compliance lego (/terms, /privacy, /cookie-policy,
 * /accessibility) plus the company About page. The lego's `extra_legal_links`
 * slot (sub-processor lists, DPA, etc.) can be appended here in a follow-up.
 */
import Link from "next/link";

const FOOTER_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/about", label: "About" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookie-policy", label: "Cookie Policy" },
  { href: "/accessibility", label: "Accessibility" },
];

export function Footer(): JSX.Element {
  const company = process.env.COMPANY_NAME || "This company";
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-gray-200 py-6 text-sm text-gray-500">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <span>
          © {year} {company}. All rights reserved.
        </span>
        <nav className="flex flex-wrap gap-4">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-gray-900">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
