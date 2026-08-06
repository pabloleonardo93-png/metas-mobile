import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/shared/theme';

interface BrandLogoProps {
  accessibilityLabel?: string;
  color?: string;
  cutoutColor?: string;
  size?: number;
}

export function BrandLogo({
  accessibilityLabel = 'Logo Meta',
  color = colors.primary,
  cutoutColor = colors.surface,
  size = 104,
}: BrandLogoProps) {
  const height = Math.round(size * 0.78);

  return (
    <Svg
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      height={height}
      viewBox="0 0 160 128"
      width={size}
    >
      <Path
        d="M29 105V35L78 78L130 30V105"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="22"
      />
      <Path
        d="M10 108C48 101 88 84 117 61C130 51 139 38 145 23"
        fill="none"
        stroke={cutoutColor}
        strokeLinecap="round"
        strokeWidth="20"
      />
      <Path
        d="M7 103C49 97 87 81 117 58C130 48 139 35 145 22C141 39 132 53 119 66C90 94 50 112 20 120Z"
        fill={color}
      />
      <Circle cx="147" cy="15" fill={color} r="8" />
    </Svg>
  );
}
