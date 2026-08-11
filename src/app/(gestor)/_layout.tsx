import { Stack } from 'expo-router';

import { EmployeesProvider } from '@/features/employees/context/EmployeesContext';

export default function ManagerLayout() {
  return (
    <EmployeesProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="configuracao-metas" />
        <Stack.Screen name="metas" />
        <Stack.Screen name="equipe" />
        <Stack.Screen name="campanhas" />
        <Stack.Screen name="perfil" />
      </Stack>
    </EmployeesProvider>
  );
}
