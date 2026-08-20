import { StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/components/AppText';
import { colors, radius, spacing } from '@/shared/theme';

interface AutomaticDaysFieldsProps {
  remainingDays: number | null;
  title: string;
  totalDays: number | null;
  totalLabel: string;
}

function formatValue(value: number | null): string {
  return value === null ? '--' : String(value);
}

export function AutomaticDaysFields({
  remainingDays,
  title,
  totalDays,
  totalLabel,
}: AutomaticDaysFieldsProps) {
  return (
    <View style={styles.group}>
      <AppText variant="label">{title}</AppText>

      <View style={styles.row}>
        <View style={styles.fieldColumn}>
          <AppText color="textMuted" variant="caption">
            Restantes
          </AppText>
          <View
            accessibilityLabel={`Dias restantes: ${formatValue(remainingDays)}`}
            style={styles.readOnlyField}
          >
            <AppText variant="bodyMedium">{formatValue(remainingDays)}</AppText>
          </View>
        </View>

        <AppText accessibilityElementsHidden style={styles.separator} variant="title">
          /
        </AppText>

        <View style={styles.fieldColumn}>
          <AppText color="textMuted" variant="caption">
            {totalLabel}
          </AppText>
          <View
            accessibilityLabel={`${totalLabel}: ${formatValue(totalDays)}`}
            style={styles.readOnlyField}
          >
            <AppText variant="bodyMedium">{formatValue(totalDays)}</AppText>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldColumn: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  group: {
    gap: spacing.sm,
  },
  readOnlyField: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  separator: {
    marginTop: spacing.lg,
  },
});
