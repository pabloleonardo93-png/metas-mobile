export interface EmployeeDailyResult {
  date: string;
  soldAmount: number;
}

export interface EmployeePerformance {
  dailyResults: EmployeeDailyResult[];
  employeeId: string;
  referenceDate: string;
}

export interface EmployeePerformanceSummary {
  monthSales: number;
  todaySales: number;
  weekSales: number;
}

export type DailyGoalPerformanceStatus = 'ACHIEVED' | 'EXCEEDED' | 'PENDING' | 'UNAVAILABLE';

export interface DailyGoalPerformance {
  dailyGoal: number;
  exceededAmount: number;
  progress: number;
  remainingAmount: number;
  soldAmount: number;
  status: DailyGoalPerformanceStatus;
}

export interface DailyResultWithPerformance extends EmployeeDailyResult {
  performance: DailyGoalPerformance;
}
