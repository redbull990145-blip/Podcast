import type { Metadata, Viewport } from "next";
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
