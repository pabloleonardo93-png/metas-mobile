import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppProviders } from '@/providers/AppProviders';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { colors } from '@/shared/theme';

export default function RootLayout() {
  return (
    <AppProviders>
      <AuthGate>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerShown: false,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(funcionario)" />
          <Stack.Screen name="(gestor)" />
        </Stack>
      </AuthGate>
    </AppProviders>
  );
}
