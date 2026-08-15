import { useRouter } from 'expo-router';
import { Button } from '@/components/button';
import { ScreenMessage } from '@/components/screen-message';
import { useDownloadIndex } from '@/lib/downloads/store';
import { useTranslator } from '@/lib/i18n';
import { heldProgressCount } from '@/lib/sync/outbox';

/**
 * What a screen shows instead of an error, when the reason it is empty is that
 * there is no connection.
 *
 * The distinction matters. "Couldn't load your library" describes a fault and
 * offers nothing; "you're offline, here is what you saved" describes a
 * situation and offers the one action that works. Same failed request, opposite
 * feeling — and only one of them is true when a phone goes into a tunnel.
 *
 * The way out is only offered when there is something behind it. A button to an
 * empty Downloads screen is a second dead end.
 */
export function OfflineNotice() {
  const t = useTranslator();
  const router = useRouter();

  const hasSaved = Object.values(useDownloadIndex()).some(
    (record) => record.status === 'complete',
  );

  /**
   * Reassurance that listening done offline is not being thrown away.
   *
   * Read plainly rather than subscribed to: this screen only exists while there
   * is no connection, and the count cannot fall until there is one. Nothing to
   * re-render for.
   */
  const held = heldProgressCount();

  const body = [
    hasSaved ? t.t('offline.body') : t.t('offline.nothingSaved'),
    held > 0 ? t.t('offline.willSync') : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ScreenMessage
      title={t.t('offline.title')}
      body={body}
      action={
        hasSaved ? (
          <Button
            label={t.t('offline.openDownloads')}
            onPress={() => router.push('/downloads')}
          />
        ) : undefined
      }
    />
  );
}
