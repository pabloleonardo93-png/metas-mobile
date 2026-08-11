import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { TeamRoleField } from '@/features/metas/components/TeamRoleField';
import { TeamWeightBreakdown } from '@/features/metas/components/TeamWeightBreakdown';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface TeamDistributionSectionProps {
  distribution: TeamDistribution[];
  onChange: (distribution: TeamDistribution[]) => void;
}

export function TeamDistributionSection({ distribution, onChange }: TeamDistributionSectionProps) {
  function updateQuantity(index: number, quantity: number) {
    onChange(
      distribution.map((role, roleIndex) =>
        roleIndex === index ? { ...role, quantity: Math.max(0, quantity) } : role,
      ),
    );
  }

  function updateWeight(index: number, weight: number) {
    const safeWeight = Number.isFinite(weight) ? Math.max(0, Math.round(weight * 10) / 10) : 0;

    onChange(
      distribution.map((role, roleIndex) =>
        roleIndex === index ? { ...role, weight: safeWeight } : role,
      ),
    );
  }

  function showWeightHelp() {
    Alert.alert(
      'Como funcionam os pesos',
      'O peso define quanto da meta diária é atribuído a cada cargo. Quanto maior o peso, maior a meta individual daquele cargo. A quantidade de funcionários influencia o peso total usado na distribuição.',
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <AppText accessibilityRole="header" variant="title">
            Distribuição por Equipe
          </AppText>
          <AppText color="textMuted" variant="caption">
            Ajuste quantidades e pesos por cargo
          </AppText>
        </View>

        <Pressable
          accessibilityHint="Explica como os pesos influenciam a distribuição"
          accessibilityLabel="Entenda os pesos"
          accessibilityRole="button"
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.infoButton, pressed && styles.infoButtonPressed]}
          onPress={showWeightHelp}
        >
          <AppText color="primary" variant="bodyMedium">
            i
          </AppText>
        </Pressable>
      </View>

      <View style={styles.roles}>
        {distribution.map((role, index) => (
          <TeamRoleField
            key={role.role}
            distribution={role}
            onQuantityChange={(quantity) => updateQuantity(index, quantity)}
            onWeightChange={(weight) => updateWeight(index, weight)}
          />
        ))}
      </View>

      <TeamWeightBreakdown distribution={distribution} />
    </View>
  );
}

const styles = StyleSheet.create({
  headingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  infoButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  infoButtonPressed: {
    backgroundColor: colors.border,
  },
  roles: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
});
