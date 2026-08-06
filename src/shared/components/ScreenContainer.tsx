import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';

import { colors } from '@/shared/theme';

type ScreenContainerProps = PropsWithChildren<SafeAreaViewProps>;

export function ScreenContainer({ children, style, ...props }: ScreenContainerProps) {
  return (
    <SafeAreaView style={[styles.container, style]} {...props}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
