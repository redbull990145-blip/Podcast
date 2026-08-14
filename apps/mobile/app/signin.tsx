import { ApiClientError } from '@cue/api-client';
import { formatFieldErrors, PASSWORD_MIN, signInInput, signUpInput } from '@cue/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { useSignIn, useSignUp } from '@/lib/session';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Sign in, or create an account.
 *
 * One screen with a mode switch rather than two routes: the fields are the
 * same bar one, and someone who guessed wrong should not have to navigate to
 * fix it.
 *
 * Nothing here gates listening. Browsing, searching and playing all work
 * signed-out; an account buys the library and cross-device resume, and the
 * copy says so rather than implying the app is locked.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useSignIn();
  const signUp = useSignUp();
  const active = mode === 'signin' ? signIn : signUp;

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = () => {
    // The same schema the server enforces, so the form rejects exactly what
    // the API would rather than approximating it.
    const parsed =
      mode === 'signup'
        ? signUpInput.safeParse({ email, password, name })
        : signInInput.safeParse({ email, password });

    if (!parsed.success) {
      setFieldErrors(formatFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});

    const onDone = {
      onSuccess: () => router.back(),
      onError: (caught: unknown) => {
        // The envelope carries field-level detail for exactly this. Without
        // reading it, a rejection lands as one message at the foot of the
        // form and the field it is about stays unmarked.
        if (caught instanceof ApiClientError && caught.fields) setFieldErrors(caught.fields);
      },
    };

    if (mode === 'signin') {
      signIn.mutate(signInInput.parse({ email, password }), onDone);
    } else {
      signUp.mutate(signUpInput.parse({ email, password, name }), onDone);
    }
  };

  // Suppressed once a field is marked: the same complaint in two places at
  // once reads as two problems.
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const message =
    hasFieldErrors || !active.error
      ? null
      : active.error instanceof ApiClientError
        ? active.error.message
        : 'Something went wrong. Try again.';

  // Deliberately not gated on validity. A disabled button that never says why
  // is the worst version of this form — press it and the fields explain
  // themselves.
  const canSubmit = !active.isPending;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[10] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[type('title1'), { color: theme.textPrimary }]}>
          {mode === 'signin' ? 'Welcome back' : 'Create an account'}
        </Text>
        <Text style={[type('callout'), { color: theme.textSecondary, marginTop: space[2] }]}>
          Your library and your place in every episode, on every device.
        </Text>

        <View style={styles.fields}>
          {mode === 'signup' ? (
            <Field
              label="Name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              textContentType="name"
              error={fieldErrors['name']}
            />
          ) : null}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            error={fieldErrors['email']}
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            hint={mode === 'signup' ? `At least ${PASSWORD_MIN} characters` : undefined}
            error={fieldErrors['password']}
          />
        </View>

        {message ? (
          <Text style={[type('caption'), { color: theme.danger, marginTop: space[4] }]}>
            {message}
          </Text>
        ) : null}

        <Button
          label={
            active.isPending
              ? 'One moment…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'
          }
          onPress={submit}
          disabled={!canSubmit || active.isPending}
          style={styles.submit}
        />

        <Pressable
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          accessibilityRole="button"
          style={styles.switch}
        >
          <Text style={[type('callout'), { color: theme.accentText }]}>
            {mode === 'signin'
              ? 'No account yet? Create one'
              : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * A labelled text input.
 *
 * The error is folded into `accessibilityLabel` rather than only rendered
 * beneath the field. React Native has neither `aria-describedby` nor an
 * invalid state in `accessibilityState`, so a message sitting in a sibling
 * `<Text>` is announced separately from the input it belongs to — if the
 * reader reaches it at all. Reading it as part of the field is the closest
 * the platform gets to describing the input.
 */
function Field({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
} & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[type('caption'), { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={error ? `${label}. ${error}` : label}
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.input,
          type('body'),
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: error ? theme.danger : theme.border,
            color: theme.textPrimary,
          },
        ]}
      />
      {error ? (
        <Text style={[type('caption'), { color: theme.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[type('caption'), { color: theme.textTertiary }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[6], flexGrow: 1 },
  fields: { marginTop: space[8], gap: space[5] },
  field: { gap: space[2] },
  input: {
    minHeight: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  submit: { marginTop: space[8] },
  switch: { marginTop: space[5], alignItems: 'center', padding: space[2] },
});
