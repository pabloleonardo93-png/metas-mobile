export const colors = {
  background: '#FFF9F8',
  surface: '#FFFFFF',
  primary: '#F21F26',
  primaryPressed: '#D9161D',
  primarySubtle: '#FFF0EF',
  onPrimary: '#FFFFFF',
  text: '#1D1717',
  textMuted: '#796968',
  border: '#E8D8D6',
  error: '#B42318',
  disabled: '#D8CECC',
  focus: '#F21F26',
  success: '#147D64',
  successSubtle: '#E7F6F0',
} as const;

export type ColorToken = keyof typeof colors;
