import { Pressable, StyleSheet, View } from 'react-native';

import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface TeamRoleFieldProps {
  distribution: TeamDistribution;
  onQuantityChange: (quantity: number) => void;
  onWeightChange: (weight: number) => void;
}

interface StepperProps {
  decrementDisabled?: boolean;
  label: string;
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
}

function Stepper({
  decrementDisabled = false,
  label,
  value,
  onDecrement,
  onIncrement,
}: StepperProps) {
  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="adjustable"
      style={styles.stepper}
    >
      <Pressable
        accessibilityLabel={`Diminuir ${label.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: decrementDisabled }}
        disabled={decrementDisabled}
        hitSlop={spacing.xs}
        style={({ pressed }) => [
          styles.stepButton,
          decrementDisabled && styles.stepButtonDisabled,
          pressed && !decrementDisabled && styles.stepButtonPressed,
        ]}
        onPress={onDecrement}
      >
        <AppText color={decrementDisabled ? 'textMuted' : 'primary'} variant="title">
          -
        </AppText>
      </Pressable>

      <AppText style={styles.stepValue} variant="bodyMedium">
        {value}
      </AppText>

      <Pressable
        accessibilityLabel={`Aumentar ${label.toLowerCase()}`}
        accessibilityRole="button"
        hitSlop={spacing.xs}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]}
        onPress={onIncrement}
      >
        <AppText color="primary" variant="title">
          +
        </AppText>
      </Pressable>
    </View>
  );
}

export function TeamRoleField({
  distribution,
  onQuantityChange,
  onWeightChange,
}: TeamRoleFieldProps) {
  const labels = TEAM_ROLE_LABELS[distribution.role];

  return (
    <View style={styles.card}>
      <AppText style={styles.roleName} variant="bodyMedium">
        {labels.plural}
      </AppText>

      <View style={styles.controlRow}>
        <AppText color="textMuted" variant="caption">
          Quantidade
        </AppText>
        <Stepper
          decrementDisabled={distribution.quantity === 0}
          label={`Quantidade de ${labels.plural}`}
          value={`${distribution.quantity}`}
          onDecrement={() => onQuantityChange(Math.max(distribution.quantity - 1, 0))}
          onIncrement={() => onQuantityChange(distribution.quantity + 1)}
        />
      </View>

      <View style={styles.controlRow}>
        <AppText color="textMuted" variant="caption">
          Peso individual
        </AppText>
        <Stepper
          decrementDisabled={distribution.weight === 0}
          label={`Peso de ${labels.plural}`}
          value={formatDecimal(distribution.weight)}
          onDecrement={() => onWeightChange(distribution.weight - 0.1)}
          onIncrement={() => onWeightChange(distribution.weight + 0.1)}
        />
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
  controlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
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
  stepValue: {
    minWidth: 48,
    textAlign: 'center',
  },
});
