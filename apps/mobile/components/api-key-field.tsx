import { queryKeys } from '@cue/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/button';
import { api } from '@/lib/api';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Bring your own key.
 *
 * The key is **write-only**: there is no endpoint that returns it, not even
 * masked, so this field is never pre-filled and "edit" is not an operation —
 * you replace it or you remove it. That is the honest interface for a secret
 * the server encrypts and cannot read back, and showing a masked value in a
 * disabled input would imply we hold it in a form we could reveal.
 */
export function ApiKeyField() {
  const theme = useTheme();
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

  // Signed out — the Account section below already offers a sign-in, so
  // repeating the invitation here would be noise.
  if (isPending || error || !data) return null;

  const { quota } = data;

  if (quota.byok) {
    return (
      <View>
        <Text style={[type('body'), { color: theme.textPrimary }]}>
          {`Your key is saved (…${quota.hint})`}
        </Text>
        <Text style={[type('caption'), { color: theme.textTertiary, marginTop: 2 }]}>
          AI features are unlimited and billed to your Groq account.
        </Text>

        <Button
          label={remove.isPending ? 'Removing…' : 'Remove'}
          variant="secondary"
          disabled={remove.isPending}
          onPress={() => remove.mutate()}
          style={styles.button}
        />
      </View>
    );
  }

  return (
    <View>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder="gsk_…"
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel="Groq API key"
        // Not shoulder-readable, and never offered to a password manager as a
        // username.
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          type('callout'),
          styles.input,
          { color: theme.textPrimary, backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      />

      <Button
        label={save.isPending ? 'Checking…' : 'Save key'}
        disabled={save.isPending || key.trim() === ''}
        onPress={() => save.mutate()}
        style={styles.button}
      />

      {save.error ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[type('caption'), { color: theme.danger, marginTop: space[3] }]}
        >
          {save.error instanceof Error ? save.error.message : 'That key could not be saved'}
        </Text>
      ) : null}

      <Text style={[type('caption'), { color: theme.textTertiary, marginTop: space[3] }]}>
        {quota.operatorAvailable
          ? `Without one you get ${quota.limit} AI requests a day (${quota.remaining} left).`
          : 'This server has no shared key, so AI features need your own.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  button: { marginTop: space[4], alignSelf: 'flex-start' },
});
