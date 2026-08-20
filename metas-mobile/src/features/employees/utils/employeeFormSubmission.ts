import type {
  EmployeeFormErrors,
  EmployeeFormValues,
} from '@/features/employees/types/employee.types';
import {
  type EmployeeMutationFeedback,
  type EmployeeMutationRunner,
} from '@/features/employees/utils/employeeMutationFeedback';
import { normalizeEmployeeEmail } from '@/features/employees/utils/validateEmployeeForm';
import type { UserRole } from '@/shared/types/userRole';

export const EMPLOYEE_FORM_VALIDATION_FEEDBACK: EmployeeMutationFeedback = {
  message: 'Revise os campos destacados.',
  type: 'error',
};

export type EmployeeFormSubmissionResult = 'duplicate' | 'failed' | 'invalid' | 'succeeded';

interface EmployeeFormSubmissionOptions {
  errors: EmployeeFormErrors;
  messages: {
    error: string;
    success: string;
  };
  onFeedback(feedback: EmployeeMutationFeedback | null): void;
  onFinished(): void;
  onStarted(): void;
  onSubmit(values: EmployeeFormValues & { role: UserRole }): Promise<void> | void;
  onSuccess(): void;
  runner: EmployeeMutationRunner;
  values: EmployeeFormValues;
}

export async function submitEmployeeForm({
  errors,
  messages,
  onFeedback,
  onFinished,
  onStarted,
  onSubmit,
  onSuccess,
  runner,
  values,
}: EmployeeFormSubmissionOptions): Promise<EmployeeFormSubmissionResult> {
  const role = values.role;

  if (Object.keys(errors).length > 0 || !role) {
    onFeedback(EMPLOYEE_FORM_VALIDATION_FEEDBACK);
    return 'invalid';
  }

  const outcome = await runner.run(
    () =>
      Promise.resolve(
        onSubmit({
          ...values,
          email: normalizeEmployeeEmail(values.email),
          name: values.name.trim(),
          role,
        }),
      ),
    messages,
    {
      onFinished,
      onStarted: () => {
        onFeedback(null);
        onStarted();
      },
    },
  );

  if (!outcome) {
    return 'duplicate';
  }

  onFeedback(outcome.feedback);
  if (!outcome.ok) {
    return 'failed';
  }

  onSuccess();
  return 'succeeded';
}
