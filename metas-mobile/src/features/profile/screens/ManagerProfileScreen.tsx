import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { useAuthenticatedUser } from '@/features/auth/context/AuthContext';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';

export function ManagerProfileScreen() {
  const currentManager = useAuthenticatedUser();

  return (
    <ProfileScreen
      bottomNavigation={<ManagerBottomNavigation activeTab="profile" />}
      user={currentManager}
    />
  );
}
