import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { useEmployees } from '@/features/employees/context/EmployeesContext';
import { currentManagerMock } from '@/features/employees/mocks/employees.mock';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';

export function ManagerProfileScreen() {
  const { employees } = useEmployees();
  const currentManager =
    employees.find((employee) => employee.id === currentManagerMock.id) ?? currentManagerMock;

  return (
    <ProfileScreen
      bottomNavigation={<ManagerBottomNavigation activeTab="profile" />}
      user={currentManager}
    />
  );
}
