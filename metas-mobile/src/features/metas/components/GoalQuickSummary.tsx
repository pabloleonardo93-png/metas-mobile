import { StyleSheet, View } from 'react-native';

import type { CurrentGoalMetrics } from '@/features/metas/types/goalSettings.types';
import { AppIcon, type AppIconName, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatBrazilianCurrency, formatPercentage } from '@/shared/utils/formatters';

interface GoalQuickSummaryProps {
  metrics: CurrentGoalMetrics;
}

interface GoalSummaryItem {
  icon: AppIconName;
  label: string;
  value: string;
}

export function GoalQuickSummary({ metrics }: GoalQuickSummaryProps) {
  const items: GoalSummaryItem[] = [
    {
      icon: 'wallet',
      label: 'Meta diária necessária',
      value: formatBrazilianCurrency(metrics.dailyTarget),
    },
    {
      icon: 'calendar',
      label: 'Dias úteis restantes',
      value: String(metrics.remainingBusinessDays),
    },
    {
      icon: 'chart',
      label: 'Percentual atingido',
      value: formatPercentage(metrics.progress),
    },
    {
      icon: 'target',
      label: 'Valor restante',
      value: formatBrazilianCurrency(metrics.remaining),
    },
  ];

  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title">
        Resumo da meta
      </AppText>

      <View style={styles.grid}>
        {items.map((item, index) => (
          <View
            key={item.label}
            style={[styles.item, index % 2 === 1 && styles.itemRight, index < 2 && styles.itemTop]}
          >
            <View style={styles.iconBox}>
              <AppIcon color={colors.primary} name={item.icon} size={19} />
            </View>
            <View style={styles.copy}>
              <AppText color="textMuted" numberOfLines={2} variant="caption">
                {item.label}
              </AppText>
              <AppText
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                numberOfLines={1}
                variant="bodyMedium"
              >
                {item.value}
              </AppText>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  grid: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  item: {
    alignItems: 'center',
    flexBasis: '50%',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 88,
    padding: spacing.md,
  },
  itemRight: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
  },
  itemTop: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
