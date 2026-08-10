import { StyleSheet, View } from 'react-native';

import { TeamRoleField } from '@/features/metas/components/TeamRoleField';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { AppText } from '@/shared/components';
import { spacing } from '@/shared/theme';

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

  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title">
        Distribuição por Equipe
      </AppText>

      <View style={styles.roles}>
        {distribution.map((role, index) => (
          <TeamRoleField
            key={role.role}
            distribution={role}
            onQuantityChange={(quantity) => updateQuantity(index, quantity)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  roles: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
});
