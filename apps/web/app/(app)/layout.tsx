import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

/**
 * The app shell wraps this group only.
 *
 * Auth lives in its own group so signing in is not framed by a sidebar full of
 * destinations you cannot use yet.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
