import type { ViewStyle } from 'react-native';

import { colors } from '@/shared/theme/colors';

export const shadows = {
  card: {
    elevation: 2,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  panel: {
    elevation: 1,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
  },
} satisfies Record<string, ViewStyle>;
