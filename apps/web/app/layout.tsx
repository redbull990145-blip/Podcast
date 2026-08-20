import { directionOf } from '@cue/i18n';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { resolveLocale } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

/**
 * Geist for the interface.
 *
 * Flat terminals, very even colour, and numerals that hold their width — which
 * is what a screen full of durations and timestamps actually needs. It is the
 * face the design is drawn in.
 */
const geist = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist',
  display: 'swap',
  // Reserves the right metrics so swapping from the fallback doesn't shift
  // the page — the single biggest source of layout shift on a text-heavy app.
  adjustFontFallback: true,
});

/**
 * Geist Mono, for timecodes only.
 *
 * Elapsed and remaining times are read as *positions*, and in a proportional
 * face 1:04:22 is a different width from 1:14:22 — so the numbers shuffle
 * sideways while the audio plays. `tabular-nums` fixes the digits' widths but
 * not the colons', and it cannot make a timecode look like a different kind of
 * thing from the sentence beside it. This can.
 */
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
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
    { media: '(prefers-color-scheme: dark)', color: '#17140F' },
    { media: '(prefers-color-scheme: light)', color: '#FBFAF7' },
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
    <html
      lang={locale}
      dir={direction}
      suppressHydrationWarning
      /*
        The font variables go on <html>, not <body>, and that is load-bearing.

        `--font-sans` is declared on `:root` in globals.css and its value
        references `--font-geist`. A custom property containing `var()` is
        substituted at computed-value time *on the element it is declared on* —
        so with `--font-geist` defined only on <body>, `--font-sans` resolved
        against a :root where it did not exist, became guaranteed-invalid there,
        and inherited down as nothing. The whole app rendered in the system
        fallback while every stylesheet said Geist.
      */
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <head>
        {/*
          Apply the stored theme before the first paint.

          It has to be a blocking inline script and it has to be in <head>: the
          alternative is an effect, which runs after the browser has already
          painted, so anyone who chose light would see a frame of the dark app
          on every navigation that reloads the document. One `dataset` write is
          cheaper than the flash it prevents.

          Absent or unrecognised means *follow the system*, which is what the
          `prefers-color-scheme` block in tokens.css already does — so the
          script writes nothing at all in the common case rather than baking a
          choice nobody made. The key matches STORAGE_KEY in
          components/shell/theme-toggle.tsx; a script tag cannot import it.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('cue-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        {/* The shell belongs to the (app) group, not here — auth renders
            without it. */}
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
