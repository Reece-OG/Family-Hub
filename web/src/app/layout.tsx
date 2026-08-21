import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeScript";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { APP_NAME } from "@/lib/app-name";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "A self-hosted home and family calendar, to-do, and shopping app.",
  icons: { icon: "/favicon.svg" },
  manifest: "/manifest.webmanifest",
  // These drive iOS Safari's "Add to Home Screen" standalone mode. Chrome /
  // Android pick the same info up out of the webmanifest.
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  applicationName: APP_NAME,
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1016" },
  ],
  width: "device-width",
  initialScale: 1,
  // iOS standalone mode needs this to render under the notch / home bar so
  // the app feels native.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        {/* Belt-and-braces meta tags: Next.js emits most of these from the
            metadata block above, but iOS Safari historically ignores some
            when embedded in a nested route, so we spell them out too. */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
