import { StyleSheet, View } from 'react-native';

import {
  DashboardIcon,
  type DashboardIconName,
} from '@/features/dashboard/components/DashboardIcon';
import type { ManagerDashboardMetrics } from '@/features/dashboard/types/managerDashboard';
import { formatBrazilianCurrency } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface ManagerQuickSummaryProps {
  metrics: ManagerDashboardMetrics;
}

interface SummaryItem {
  icon: DashboardIconName;
  label: string;
  value: string;
}

export function ManagerQuickSummary({ metrics }: ManagerQuickSummaryProps) {
  const items: SummaryItem[] = [
    {
      icon: 'wallet',
      label: 'Meta diária',
      value: formatBrazilianCurrency(metrics.dailyTarget),
    },
    {
      icon: 'calendar',
      label: 'Dias restantes',
      value: String(metrics.remainingBusinessDays),
    },
    {
      icon: 'users',
      label: 'Equipe ativa',
      value: String(metrics.activeEmployees),
    },
    {
      icon: 'target',
      label: 'Campanhas ativas',
      value: String(metrics.activeCampaigns),
    },
  ];

  return (
    <View style={styles.container}>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.item, index % 2 === 1 && styles.itemRight, index < 2 && styles.itemTop]}
        >
          <View style={styles.iconBox}>
            <DashboardIcon color={colors.primary} name={item.icon} size={20} />
          </View>
          <View style={styles.copy}>
            <AppText color="textMuted" numberOfLines={2} variant="caption">
              {item.label}
            </AppText>
            <AppText
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              numberOfLines={1}
              variant="bodyMedium"
            >
              {item.value}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    flexBasis: '50%',
    gap: spacing.sm,
    minHeight: 96,
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
});
