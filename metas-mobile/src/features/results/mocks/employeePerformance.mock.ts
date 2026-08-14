import type { EmployeeCampaignContribution } from '@/features/employees/types/employee.types';
import { currentEmployeeMock } from '@/features/employees/mocks/employees.mock';
import type { EmployeePerformance } from '@/features/results/types/employeePerformance.types';

export const employeePerformanceMock = {
  employeeId: currentEmployeeMock.id,
  referenceDate: '2026-08-11',
  dailyResults: [
    { date: '2026-08-03', soldAmount: 680 },
    { date: '2026-08-04', soldAmount: 720 },
    { date: '2026-08-05', soldAmount: 870 },
    { date: '2026-08-06', soldAmount: 980 },
    { date: '2026-08-07', soldAmount: 1_100 },
    { date: '2026-08-08', soldAmount: 1_250 },
    { date: '2026-08-10', soldAmount: 2_310 },
    { date: '2026-08-11', soldAmount: 540 },
  ],
} satisfies EmployeePerformance;

export const employeeCampaignContributionsMock: EmployeeCampaignContribution[] =
  currentEmployeeMock.performance?.campaignContributions.map((contribution) => ({
    ...contribution,
  })) ?? [];
