import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/shared/theme';

interface GoalProgressBarProps {
  label: string;
  progress: number;
  variant?: 'primary' | 'inverse';
}

export function GoalProgressBar({ label, progress, variant = 'primary' }: GoalProgressBarProps) {
  const normalizedProgress = Math.min(100, Math.max(0, progress));

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ max: 100, min: 0, now: Math.round(normalizedProgress) }}
      style={[styles.track, variant === 'inverse' ? styles.inverseTrack : styles.primaryTrack]}
    >
      <View
        style={[
          styles.fill,
          variant === 'inverse' ? styles.inverseFill : styles.primaryFill,
          { width: `${normalizedProgress}%` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    borderRadius: radius.pill,
    height: '100%',
  },
  inverseFill: {
    backgroundColor: colors.onPrimary,
  },
  inverseTrack: {
    backgroundColor: colors.primaryPressed,
  },
  primaryFill: {
    backgroundColor: colors.primary,
  },
  primaryTrack: {
    backgroundColor: colors.primarySubtle,
  },
  track: {
    borderRadius: radius.pill,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
});
