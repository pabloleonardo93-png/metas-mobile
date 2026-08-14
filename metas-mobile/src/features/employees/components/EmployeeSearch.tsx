import { AppIcon, AppTextInput } from '@/shared/components';
import { colors } from '@/shared/theme';

interface EmployeeSearchProps {
  onChangeText: (value: string) => void;
  value: string;
}

export function EmployeeSearch({ onChangeText, value }: EmployeeSearchProps) {
  return (
    <AppTextInput
      accessibilityLabel="Buscar funcionário por nome ou cargo"
      autoCapitalize="none"
      autoCorrect={false}
      leftAdornment={<AppIcon color={colors.textMuted} name="search" size={22} />}
      placeholder="Buscar funcionário"
      returnKeyType="search"
      value={value}
      onChangeText={onChangeText}
    />
  );
}
