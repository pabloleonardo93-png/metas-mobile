import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { useAuthenticatedUser } from '@/features/auth/context/AuthContext';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';

export function EmployeeProfileScreen() {
  const currentEmployee = useAuthenticatedUser();

  return (
    <ProfileScreen
      bottomNavigation={<EmployeeBottomNavigation activeTab="profile" />}
      user={currentEmployee}
    />
  );
}
