export type LogContext = Readonly<Record<string, boolean | null | number | string>>;

export interface Logger {
  error(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
}

const writeLog = (level: 'error' | 'info', event: string, context: LogContext = {}): void => {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  });

  const output = level === 'error' ? process.stderr : process.stdout;
  output.write(`${entry}\n`);
};

export const logger: Logger = {
  error: (event, context) => {
    writeLog('error', event, context);
  },
  info: (event, context) => {
    writeLog('info', event, context);
  },
};
