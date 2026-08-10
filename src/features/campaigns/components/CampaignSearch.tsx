import { AppIcon, AppTextInput } from '@/shared/components';
import { colors } from '@/shared/theme';

interface CampaignSearchProps {
  onChangeText: (value: string) => void;
  value: string;
}

export function CampaignSearch({ onChangeText, value }: CampaignSearchProps) {
  return (
    <AppTextInput
      accessibilityLabel="Buscar campanha por marca ou produto"
      autoCapitalize="none"
      autoCorrect={false}
      leftAdornment={<AppIcon color={colors.textMuted} name="search" size={22} />}
      placeholder="Buscar campanha"
      returnKeyType="search"
      value={value}
      onChangeText={onChangeText}
    />
  );
}
