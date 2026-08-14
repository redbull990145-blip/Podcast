import { StyleSheet, Text, View } from 'react-native';
import { space, type, useTheme } from '@/theme';

/**
 * An empty, loading or error state.
 *
 * Empty states teach rather than apologise, so the body says what to do next
 * rather than restating that nothing is here.
 */
export function ScreenMessage({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={[type('title3'), { color: theme.textPrimary, textAlign: 'center' }]}>
        {title}
      </Text>

      {body ? (
        <Text
          style={[
            type('callout'),
            { color: theme.textSecondary, marginTop: space[2], textAlign: 'center' },
          ]}
        >
          {body}
        </Text>
      ) : null}

      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[8],
    paddingVertical: space[10],
  },
  action: { marginTop: space[5] },
});
