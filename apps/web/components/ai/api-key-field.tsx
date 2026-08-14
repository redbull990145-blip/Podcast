'use client';

import { queryKeys } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * Bring your own key.
 *
 * The design constraint that shapes everything here: **the key is write-only.**
 * There is no endpoint that returns it, not even masked, so this field can
 * never be pre-filled and "edit" is not an operation — you replace it or you
 * remove it. That is the honest interface for a secret we encrypt and cannot
 * read back, and pretending otherwise (a masked value in a disabled input)
 * would imply we hold it in a form we could show you.
 *
 * The key is verified against the provider before it is saved, so a typo is
 * caught here, next to the field, rather than surfacing an hour later as an
 * unexplained failure on an unrelated screen.
 */
export function ApiKeyField() {
  const t = useTranslator();
  const client = useQueryClient();
  const [key, setKey] = useState('');

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.ai.quota(),
    queryFn: () => api.getAiQuota(),
  });

  const save = useMutation({
    mutationFn: () => api.saveApiKey(key.trim()),
    onSuccess: (result) => {
      setKey('');
      client.setQueryData(queryKeys.ai.quota(), result);
      // Every episode's panel shows the allowance, and all of them just became
      // wrong.
      void client.invalidateQueries({ queryKey: queryKeys.episode.all });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteApiKey(),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.ai.quota(), result);
      void client.invalidateQueries({ queryKey: queryKeys.episode.all });
    },
  });

  // Signed out. The section above this one already offers a sign-in, so
  // repeating the invitation here would be noise.
  if (error) return null;
  if (isPending) return null;

  const { quota } = data;

  return (
    <div>
      {quota.byok ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="type-body m-0 text-[var(--color-text-primary)]">
              {t.t('settings.keySaved', { hint: quota.hint ?? '' })}
            </p>
            <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
              {t.t('settings.keySavedHint')}
            </p>
          </div>

          <Button variant="secondary" onClick={() => remove.mutate()} busy={remove.isPending}>
            {remove.isPending ? t.t('settings.removingKey') : t.t('common.remove')}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim()) save.mutate();
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <label className="min-w-[260px] flex-1">
            <span className="sr-only">{t.t('settings.apiKey')}</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              // `password` so it is not shoulder-readable and not offered to a
              // password manager as a username.
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="gsk_…"
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 type-callout text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus-visible:border-[var(--color-accent)]"
            />
          </label>

          <Button type="submit" busy={save.isPending} disabled={!key.trim()}>
            {save.isPending ? t.t('settings.checkingKey') : t.t('settings.saveKey')}
          </Button>
        </form>
      )}

      {save.error ? (
        <p role="alert" className="type-caption mt-3 mb-0 text-[var(--color-danger)]">
          {save.error instanceof Error ? save.error.message : t.t('settings.keyFailed')}
        </p>
      ) : null}

      {!quota.byok ? (
        <p className="type-caption mt-3 mb-0 text-[var(--color-text-tertiary)]">
          {quota.operatorAvailable
            ? t.t('settings.quotaWithout', { limit: quota.limit, remaining: quota.remaining })
            : t.t('settings.noOperatorKey')}
        </p>
      ) : null}
    </div>
  );
}
