import { Pressable, StyleSheet, View } from 'react-native';

import {
  DashboardIcon,
  type DashboardIconName,
} from '@/features/dashboard/components/DashboardIcon';
import { DashboardSectionHeader } from '@/features/dashboard/components/DashboardSectionHeader';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

export type ManagementShortcut = 'campaigns' | 'goals' | 'settings' | 'team';

interface ManagementShortcutsProps {
  onOpen: (shortcut: ManagementShortcut) => void;
}

interface ShortcutItem {
  icon: DashboardIconName;
  key: ManagementShortcut;
  label: string;
}

const SHORTCUTS: readonly ShortcutItem[] = [
  { icon: 'settings', key: 'settings', label: 'Configuração Geral' },
  { icon: 'target', key: 'goals', label: 'Metas' },
  { icon: 'users', key: 'team', label: 'Equipe' },
  { icon: 'target', key: 'campaigns', label: 'Campanhas' },
];

export function ManagementShortcuts({ onOpen }: ManagementShortcutsProps) {
  return (
    <View style={styles.section}>
      <DashboardSectionHeader title="Gestão" />

      <View style={styles.grid}>
        {SHORTCUTS.map((shortcut) => (
          <Pressable
            key={shortcut.key}
            accessibilityLabel={`Abrir ${shortcut.label}`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => onOpen(shortcut.key)}
          >
            <View style={styles.iconBox}>
              <DashboardIcon color={colors.primary} name={shortcut.icon} size={22} />
            </View>
            <AppText numberOfLines={2} style={styles.label} variant="label">
              {shortcut.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  item: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 112,
    minWidth: 132,
    padding: spacing.md,
  },
  itemPressed: {
    backgroundColor: colors.primarySubtle,
    opacity: 0.8,
  },
  label: {
    letterSpacing: 0,
    textAlign: 'center',
  },
  section: {
    gap: spacing.md,
  },
});
