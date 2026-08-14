import type { Metadata } from 'next';
import { SettingsClient } from './settings-client';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings.
 *
 * Client-rendered: everything here is either this device's own preferences or
 * this listener's session, and neither exists on the server.
 */
export default function SettingsPage() {
  return <SettingsClient />;
}
