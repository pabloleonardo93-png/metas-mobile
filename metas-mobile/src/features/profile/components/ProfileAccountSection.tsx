import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon, type AppIconName, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface ProfileAccountSectionProps {
  onLogout: () => void;
  onNotifications: () => void;
  onPrivacy: () => void;
}

interface AccountAction {
  destructive?: boolean;
  icon: AppIconName;
  label: string;
  onPress: () => void;
}

export function ProfileAccountSection({
  onLogout,
  onNotifications,
  onPrivacy,
}: ProfileAccountSectionProps) {
  const actions: readonly AccountAction[] = [
    { icon: 'settings', label: 'Notificações', onPress: onNotifications },
    { icon: 'user', label: 'Privacidade', onPress: onPrivacy },
    { destructive: true, icon: 'arrow-left', label: 'Sair', onPress: onLogout },
  ];

  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title">
        Conta
      </AppText>

      <View style={styles.card}>
        {actions.map((action, index) => {
          const color = action.destructive ? colors.error : colors.text;

          return (
            <Pressable
              key={action.label}
              accessibilityLabel={action.label}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowBorder,
                pressed && styles.rowPressed,
              ]}
              onPress={action.onPress}
            >
              <View style={styles.iconContainer}>
                <AppIcon color={color} name={action.icon} size={20} />
              </View>
              <AppText
                color={action.destructive ? 'error' : 'text'}
                style={styles.label}
                variant="bodyMedium"
              >
                {action.label}
              </AppText>
              <AppIcon color={colors.textMuted} name="chevron-right" size={20} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  label: {
    flex: 1,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  rowPressed: {
    backgroundColor: colors.primarySubtle,
  },
  section: {
    gap: spacing.md,
  },
});
