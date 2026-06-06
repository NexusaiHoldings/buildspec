import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopNav } from "@/components/topnav";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@nexus/legal-and-compliance/ui/CookieBanner";
import { SupportWidget } from "@nexus/support-and-help/ui/SupportWidget";
import { AnalyticsBeacon } from "@/components/AnalyticsBeacon";
import { CommandPalette } from "@/components/CommandPalette";
import "./globals.css";

export const metadata: Metadata = {
  title: process.env.COMPANY_NAME || "Portfolio Company",
  description: "Powered by Nexus portfolio substrate",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main>{children}</main>
        <Footer />
        <CookieBanner />
        {/* Floating support launcher (substrate-lego-wiring-001). user_id is
            attributed server-side by the /api/support/tickets shim from the
            session, so the widget works anonymously too. */}
        <SupportWidget />
        <AnalyticsBeacon />
        <CommandPalette />
      </body>
    </html>
  );
}
