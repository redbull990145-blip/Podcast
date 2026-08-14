import { directionOf } from '@cue/i18n';
import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';
import { resolveLocale } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

/**
 * Inter for UI. Variable, excellent at small sizes, and the widest script
 * coverage of any free sans — which matters because this app has to render
 * Hindi, Arabic, Japanese and Korean without falling apart.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
  // Reserves the right metrics so swapping from the fallback doesn't shift
  // the page — the single biggest source of layout shift on a text-heavy app.
  adjustFontFallback: true,
});

/**
 * Instrument Serif for display only. Used on section headers and featured
 * blocks, where it does the work of making discovery feel curated rather than
 * generated. Never body copy.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Cue', template: '%s · Cue' },
  description: 'Discover, stream, and listen to podcasts.',
  applicationName: 'Cue',
};

export const viewport: Viewport = {
  // Matches --color-bg so the browser chrome and the page agree, instead of
  // flashing white behind a dark app.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08080A' },
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available — disabling it is an accessibility failure, not a
  // polish decision.
  maximumScale: 5,
};

/**
 * `lang` and `dir` are set from the server-resolved locale.
 *
 * `dir` in particular has to be here and has to be server-rendered: it mirrors
 * the entire layout, and setting it after hydration would show every reader of
 * an RTL language one frame of a left-to-right interface before it flipped.
 * It also drives the CSS logical properties the components are written in, so
 * this single attribute is what makes the app right-to-left rather than a
 * per-component override.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();
  const direction = directionOf(locale);

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <body className={`${inter.variable} ${instrumentSerif.variable}`}>
        {/* The shell belongs to the (app) group, not here — auth renders
            without it. */}
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
