import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopNav } from "@/components/topnav";
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
      </body>
    </html>
  );
}
