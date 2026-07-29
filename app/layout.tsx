import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Cadence — podcasts, properly",
    template: "%s · Cadence",
  },
  description:
    "A fast, private podcast player with AI show notes, real cross-device sync, and no lock-in.",
  applicationName: "Cadence",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Cadence" },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfe" },
    { media: "(prefers-color-scheme: dark)", color: "#15161c" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Applies the saved theme before first paint.
 *
 * This has to be a blocking inline script: doing it in React would let the
 * default (light) styles paint first, producing a white flash for dark-mode
 * users on every navigation to a fresh document.
 *
 * It goes through next/script rather than a bare <script> element. A raw script
 * tag rendered from a component is emitted correctly during SSR, but React
 * refuses to execute one during a client render and logs an error every time
 * the root layout re-renders. `beforeInteractive` gets it into the document
 * head ahead of everything else without React ever owning the element.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('cadence-theme');
    var theme = stored || 'system';
    var isDark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="cadence-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      {/*
        suppressHydrationWarning here (not just on <html>) is specifically for
        attributes browser extensions inject directly into <body> before React
        hydrates — e.g. `bis_register` from some password-manager/security
        extensions. That mismatch is real but harmless: it's an attribute we
        never render and never read, so suppressing the warning for it is
        correct, not a Band-Aid over an actual bug in our markup.
      */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
