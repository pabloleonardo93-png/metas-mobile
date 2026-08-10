import { Pressable, StyleSheet, View } from 'react-native';

import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface TeamRoleFieldProps {
  distribution: TeamDistribution;
  onQuantityChange: (quantity: number) => void;
}

export function TeamRoleField({ distribution, onQuantityChange }: TeamRoleFieldProps) {
  const labels = TEAM_ROLE_LABELS[distribution.role];
  const decrementDisabled = distribution.quantity === 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <AppText style={styles.roleName} variant="bodyMedium">
          {labels.plural}
        </AppText>
        <View style={styles.weightBadge}>
          <AppText color="primary" variant="label">
            Peso {formatDecimal(distribution.weight)}
          </AppText>
        </View>
      </View>

      <View style={styles.quantityRow}>
        <AppText color="textMuted" variant="caption">
          Quantidade
        </AppText>

        <View accessibilityRole="adjustable" style={styles.stepper}>
          <Pressable
            accessibilityLabel={`Diminuir quantidade de ${labels.plural}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: decrementDisabled }}
            disabled={decrementDisabled}
            hitSlop={spacing.xs}
            style={({ pressed }) => [
              styles.stepButton,
              decrementDisabled && styles.stepButtonDisabled,
              pressed && !decrementDisabled && styles.stepButtonPressed,
            ]}
            onPress={() => onQuantityChange(Math.max(distribution.quantity - 1, 0))}
          >
            <AppText color={decrementDisabled ? 'textMuted' : 'primary'} variant="title">
              -
            </AppText>
          </Pressable>

          <AppText
            accessibilityLabel={`${distribution.quantity} ${labels.plural}`}
            style={styles.quantityValue}
            variant="bodyMedium"
          >
            {distribution.quantity}
          </AppText>

          <Pressable
            accessibilityLabel={`Aumentar quantidade de ${labels.plural}`}
            accessibilityRole="button"
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]}
            onPress={() => onQuantityChange(distribution.quantity + 1)}
          >
            <AppText color="primary" variant="title">
              +
            </AppText>
          </Pressable>
        </View>
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
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  quantityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  quantityValue: {
    minWidth: 40,
    textAlign: 'center',
  },
  roleName: {
    flex: 1,
  },
  stepButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  stepButtonDisabled: {
    backgroundColor: colors.background,
    opacity: 0.55,
  },
  stepButtonPressed: {
    backgroundColor: colors.primarySubtle,
  },
  stepper: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  weightBadge: {
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
