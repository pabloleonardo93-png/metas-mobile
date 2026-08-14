export type UserRole = 'GESTOR' | 'BALCONISTA' | 'CAIXA' | 'FARMACEUTICO';

export type EmployeeRole = Exclude<UserRole, 'GESTOR'>;
