import "@/styles/globals.css";

import { inter } from "@/styles/fonts";

import { cn } from "@/lib/utils";
import { THEME_BOOTSTRAP } from "@/lib/theme";

import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#09090b",
};

export const metadata: Metadata = {
  title: "Colaco Calendar",
  description: "Private calendar with ntfy reminders.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Colaco" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" className={cn(inter.variable)} suppressHydrationWarning>
      <head>
        {/* Must run before paint to avoid a flash of the wrong theme, so it
            cannot be a component. The content is a local constant, not input. */}
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
