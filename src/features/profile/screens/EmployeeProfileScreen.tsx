import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { currentEmployeeMock } from '@/features/employees/mocks/employees.mock';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';

export function EmployeeProfileScreen() {
  return (
    <ProfileScreen
      bottomNavigation={<EmployeeBottomNavigation activeTab="profile" />}
      user={currentEmployeeMock}
    />
  );
}
