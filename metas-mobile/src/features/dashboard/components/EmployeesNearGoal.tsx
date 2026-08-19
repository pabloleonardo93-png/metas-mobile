import { StyleSheet, View } from 'react-native';

import { DashboardSectionHeader } from '@/features/dashboard/components/DashboardSectionHeader';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

export function EmployeesNearGoal() {
  return (
    <View style={styles.section}>
      <DashboardSectionHeader title="Mais próximos da meta" />

      <View style={styles.card}>
        <AppText color="textMuted" variant="bodyMedium">
          Nenhum resultado disponível
        </AppText>
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
    padding: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
});
