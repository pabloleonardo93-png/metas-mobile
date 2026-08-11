import { StyleSheet, View } from 'react-native';

import { EmployeeStatusBadge } from '@/features/employees/components/EmployeeStatusBadge';
import type { EmployeeStatus } from '@/features/employees/types/employee.types';
import { formatJoinedDate } from '@/features/employees/utils/employee.utils';
import { AppIcon, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface ProfileInfoSectionProps {
  email: string;
  joinedAt: string;
  status: EmployeeStatus;
}

export function ProfileInfoSection({ email, joinedAt, status }: ProfileInfoSectionProps) {
  const statusLabel = status === 'ATIVO' ? 'Ativo' : 'Inativo';
  const joinedAtLabel = formatJoinedDate(joinedAt);

  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title">
        Informações
      </AppText>

      <View style={styles.card}>
        <View accessible accessibilityLabel={`E-mail: ${email}`} style={styles.row}>
          <View style={styles.iconContainer}>
            <AppIcon color={colors.primary} name="mail" size={20} />
          </View>
          <View style={styles.copy}>
            <AppText color="textMuted" variant="caption">
              E-mail
            </AppText>
            <AppText selectable numberOfLines={2} variant="bodyMedium">
              {email}
            </AppText>
          </View>
        </View>

        <View
          accessible
          accessibilityLabel={`Status: ${statusLabel}`}
          style={[styles.row, styles.rowBorder]}
        >
          <View style={styles.iconContainer}>
            <AppIcon color={colors.primary} name="user" size={20} />
          </View>
          <View style={styles.copy}>
            <AppText color="textMuted" variant="caption">
              Status
            </AppText>
            <EmployeeStatusBadge status={status} />
          </View>
        </View>

        <View
          accessible
          accessibilityLabel={`Data de entrada: ${joinedAtLabel}`}
          style={[styles.row, styles.rowBorder]}
        >
          <View style={styles.iconContainer}>
            <AppIcon color={colors.primary} name="calendar" size={20} />
          </View>
          <View style={styles.copy}>
            <AppText color="textMuted" variant="caption">
              Data de entrada
            </AppText>
            <AppText variant="bodyMedium">{joinedAtLabel}</AppText>
          </View>
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
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
