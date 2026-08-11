import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { appRoutes } from '@/config/routes';
import { AppText } from '@/shared/components';
import { colors, iconSizes, shadows, spacing } from '@/shared/theme';

type EmployeeTab = 'home' | 'goals' | 'profile' | 'results';

interface EmployeeBottomNavigationProps {
  activeTab: EmployeeTab;
}

interface NavigationIconProps {
  color: string;
  name: EmployeeTab;
}

const iconPaths: Record<EmployeeTab, string> = {
  home: 'M3 10.8 12 3l9 7.8V21h-6v-6H9v6H3V10.8Z',
  goals:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0H4Z',
  results: 'M4 20V10m6 10V4m6 16v-7m5 7H2',
};

function NavigationIcon({ color, name }: NavigationIconProps) {
  return (
    <Svg height={iconSizes.md} viewBox="0 0 24 24" width={iconSizes.md}>
      <Path
        d={iconPaths[name]}
        fill={name === 'home' || name === 'profile' ? color : 'none'}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={name === 'goals' || name === 'results' ? 1.8 : 1.2}
      />
    </Svg>
  );
}

export function EmployeeBottomNavigation({ activeTab }: EmployeeBottomNavigationProps) {
  const router = useRouter();
  const tabs: readonly { label: string; name: EmployeeTab }[] = [
    { label: 'Início', name: 'home' },
    { label: 'Metas', name: 'goals' },
    { label: 'Resultados', name: 'results' },
    { label: 'Perfil', name: 'profile' },
  ];

  function handlePress(tab: EmployeeTab) {
    if (tab === activeTab) {
      return;
    }

    if (tab === 'home') {
      router.push(appRoutes.employeeHome);
      return;
    }

    if (tab === 'goals') {
      router.push(appRoutes.employeeGoals);
      return;
    }

    if (tab === 'results') {
      router.push(appRoutes.employeeResults);
      return;
    }

    router.push(appRoutes.employeeProfile);
  }

  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {tabs.map((tab) => {
        const isActive = tab.name === activeTab;

        return (
          <Pressable
            key={tab.name}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => handlePress(tab.name)}
          >
            <NavigationIcon color={isActive ? colors.primary : colors.textMuted} name={tab.name} />
            <AppText
              color={isActive ? 'primary' : 'textMuted'}
              style={styles.label}
              variant="label"
            >
              {tab.label}
            </AppText>
            <View style={[styles.indicator, isActive && styles.indicatorActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  indicator: {
    borderRadius: 2,
    height: 3,
    marginTop: spacing.xs,
    width: 20,
  },
  indicatorActive: {
    backgroundColor: colors.primary,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 60,
    minWidth: 44,
    opacity: 1,
    paddingHorizontal: spacing.xs,
  },
  itemPressed: {
    opacity: 0.65,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
  },
});
