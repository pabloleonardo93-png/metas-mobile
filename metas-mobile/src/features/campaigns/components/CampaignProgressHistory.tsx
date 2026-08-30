import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { CampaignProgressEntry } from '@/features/campaigns/types/campaign.types';
import { AppButton, AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';
import { formatCentsAsBrl } from '@/shared/utils/brlCurrency';

interface CampaignProgressHistoryProps {
  entries: readonly CampaignProgressEntry[];
  errorMessage: string | null;
  isLoading: boolean;
  onRetry: () => void;
}

function formatEntryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '--'
    : new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
}

export function CampaignProgressHistory({
  entries,
  errorMessage,
  isLoading,
  onRetry,
}: CampaignProgressHistoryProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Histórico de progresso
        </AppText>
        <AppText color="textMuted" variant="caption">
          Lançamentos financeiros registrados nesta campanha.
        </AppText>
      </View>

      {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {errorMessage ? (
        <View style={styles.stateCard}>
          <AppText color="error">{errorMessage}</AppText>
          <AppButton label="Tentar novamente" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
      {!isLoading && !errorMessage && entries.length === 0 ? (
        <View style={styles.stateCard}>
          <AppText variant="bodyMedium">Nenhum progresso registrado</AppText>
          <AppText color="textMuted" variant="caption">
            O primeiro lançamento aparecerá aqui.
          </AppText>
        </View>
      ) : null}
      {!errorMessage && entries.length > 0 ? (
        <View style={styles.list}>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <View style={styles.entryHeader}>
                <AppText variant="bodyMedium">{formatCentsAsBrl(entry.amountCents)}</AppText>
                <AppText color="textMuted" variant="caption">
                  {formatEntryDate(entry.createdAt)}
                </AppText>
              </View>
              <AppText color="textMuted" variant="caption">
                Quantidade: {entry.quantity === null ? 'não informada' : entry.quantity}
              </AppText>
              <AppText color="textMuted" variant="caption">
                Registrado por: {entry.createdByName}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  entry: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  entryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  heading: {
    gap: spacing.xs,
  },
  list: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  stateCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
});
