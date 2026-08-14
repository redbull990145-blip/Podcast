import type { ReactNode } from 'react';

/**
 * Auth layout.
 *
 * A route group with its own layout, so signing in is not framed by the app
 * chrome. A sidebar full of destinations you cannot use yet is noise at the
 * one moment the screen should ask exactly one thing.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">{children}</div>
    </div>
  );
}
