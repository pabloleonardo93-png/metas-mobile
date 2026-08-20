import Svg, { Path } from 'react-native-svg';

export type AppIconName =
  | 'alert-circle'
  | 'arrow-left'
  | 'calendar'
  | 'chart'
  | 'chevron-right'
  | 'check-circle'
  | 'edit'
  | 'home'
  | 'info'
  | 'mail'
  | 'package'
  | 'plus'
  | 'search'
  | 'settings'
  | 'target'
  | 'user'
  | 'users'
  | 'wallet';

interface AppIconProps {
  color: string;
  name: AppIconName;
  size?: number;
}

const ICON_PATHS: Record<AppIconName, string> = {
  'alert-circle': 'M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  'arrow-left': 'M19 12H5m6-6-6 6 6 6',
  calendar:
    'M7 2v3m10-3v3M4 9h16M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  chart: 'M4 20V10m6 10V4m6 16v-7m5 7H2',
  'check-circle': 'm8 12 3 3 5-6m5 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  'chevron-right': 'm9 18 6-6-6-6',
  edit: 'M13.5 6.5 17.5 10.5M4 20h4l11.5-11.5a2.8 2.8 0 0 0-4-4L4 16v4Z',
  home: 'M3 10.8 12 3l9 7.8V21h-6v-6H9v6H3V10.8Z',
  info: 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  mail: 'M3 6.5A3.5 3.5 0 0 1 6.5 3h11A3.5 3.5 0 0 1 21 6.5v11a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 17.5v-11Zm1 0 8 6 8-6',
  package: 'm4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10M8 5l8 4',
  plus: 'M12 5v14M5 12h14',
  search: 'm20 20-4.4-4.4M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5c0-.5 0-1-.1-1.4l2-1.5-2-3.4-2.4 1a8.4 8.4 0 0 0-2.4-1.4L14.2 3h-4.4l-.3 2.3a8.4 8.4 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.5a8.7 8.7 0 0 0 0 2.8l-2 1.5 2 3.4 2.4-1a8.4 8.4 0 0 0 2.4 1.4l.3 2.3h4.4l.3-2.3a8.4 8.4 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.4Z',
  target:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0H4Z',
  users:
    'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0H2Zm15-9a3.5 3.5 0 1 0 0-7m1 9a6 6 0 0 1 4 6',
  wallet:
    'M4 5h14a2 2 0 0 1 2 2v13H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12M15 11h7v5h-7a2.5 2.5 0 0 1 0-5Z',
};

export function AppIcon({ color, name, size = 24 }: AppIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d={ICON_PATHS[name]}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </Svg>
  );
}
