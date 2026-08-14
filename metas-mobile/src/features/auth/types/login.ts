export interface LoginFormValues {
  email: string;
  password: string;
}

export type LoginField = keyof LoginFormValues;
