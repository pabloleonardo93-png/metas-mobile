import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/components';
import { spacing } from '@/shared/theme';

interface DashboardSectionHeaderProps {
  actionLabel?: string;
  onAction?: () => void;
  title: string;
}

export function DashboardSectionHeader({
  actionLabel,
  onAction,
  title,
}: DashboardSectionHeaderProps) {
  return (
    <View style={styles.container}>
      <AppText accessibilityRole="header" style={styles.title} variant="title">
        {title}
      </AppText>

      {actionLabel && onAction ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={onAction}
        >
          <AppText color="primary" variant="label">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  actionPressed: {
    opacity: 0.6,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: 20,
    letterSpacing: 0,
    lineHeight: 28,
  },
});
