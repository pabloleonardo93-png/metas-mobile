import { StyleSheet, View } from 'react-native';

import type { PerformanceSummaryData } from '@/features/dashboard/types/employeeDashboard';
import { formatBrazilianCurrency } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface PerformanceSummaryProps {
  summary: PerformanceSummaryData;
}

export function PerformanceSummary({ summary }: PerformanceSummaryProps) {
  const items = [
    { label: 'Hoje', value: summary.hoje },
    { label: 'Semana', value: summary.semana },
    { label: 'Mês', value: summary.mes },
  ];

  return (
    <View style={styles.container}>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.item, index > 0 && styles.itemWithDivider]}>
          <AppText color="textMuted" variant="caption">
            {item.label}
          </AppText>
          <AppText
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={1}
            variant="bodyMedium"
          >
            {formatBrazilianCurrency(item.value)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  itemWithDivider: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
  },
});
