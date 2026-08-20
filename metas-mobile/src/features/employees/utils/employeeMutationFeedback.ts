import { getEmployeeApiErrorMessage } from './employeeApiError';

export interface EmployeeMutationFeedback {
  message: string;
  type: 'error' | 'success';
}

interface EmployeeMutationMessages {
  error: string;
  success: string;
}

interface EmployeeMutationLifecycle {
  onFinished?(): void;
  onStarted?(): void;
}

export type EmployeeMutationOutcome<Result> =
  | { feedback: EmployeeMutationFeedback; ok: true; value: Result }
  | { feedback: EmployeeMutationFeedback; ok: false };

export interface EmployeeMutationRunner {
  isRunning(): boolean;
  run<Result>(
    mutation: () => Promise<Result>,
    messages: EmployeeMutationMessages,
    lifecycle?: EmployeeMutationLifecycle,
  ): Promise<EmployeeMutationOutcome<Result> | null>;
}

export function createEmployeeMutationRunner(): EmployeeMutationRunner {
  let running = false;

  return {
    isRunning: () => running,
    async run<Result>(
      mutation: () => Promise<Result>,
      messages: EmployeeMutationMessages,
      lifecycle: EmployeeMutationLifecycle = {},
    ): Promise<EmployeeMutationOutcome<Result> | null> {
      if (running) return null;

      running = true;
      lifecycle.onStarted?.();
      try {
        const value = await mutation();
        return {
          feedback: { message: messages.success, type: 'success' },
          ok: true,
          value,
        };
      } catch (error: unknown) {
        return {
          feedback: {
            message: getEmployeeApiErrorMessage(error, messages.error),
            type: 'error',
          },
          ok: false,
        };
      } finally {
        running = false;
        lifecycle.onFinished?.();
      }
    },
  };
}
