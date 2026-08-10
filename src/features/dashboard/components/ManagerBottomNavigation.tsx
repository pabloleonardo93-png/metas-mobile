import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import {
  DashboardIcon,
  type DashboardIconName,
} from '@/features/dashboard/components/DashboardIcon';
import { AppText } from '@/shared/components';
import { colors, shadows, spacing } from '@/shared/theme';

export type ManagerTab = 'campaigns' | 'goals' | 'home' | 'profile' | 'team';

interface ManagerBottomNavigationProps {
  activeTab: ManagerTab;
}

interface ManagerNavigationItem {
  icon: DashboardIconName;
  label: string;
  name: ManagerTab;
  route:
    | typeof appRoutes.managerGoals
    | typeof appRoutes.managerHome
    | typeof appRoutes.managerCampaigns
    | typeof appRoutes.managerProfile
    | typeof appRoutes.managerTeam;
}

const NAVIGATION_ITEMS: readonly ManagerNavigationItem[] = [
  { icon: 'home', label: 'Início', name: 'home', route: appRoutes.managerHome },
  { icon: 'target', label: 'Metas', name: 'goals', route: appRoutes.managerGoals },
  { icon: 'users', label: 'Equipe', name: 'team', route: appRoutes.managerTeam },
  { icon: 'target', label: 'Campanhas', name: 'campaigns', route: appRoutes.managerCampaigns },
  { icon: 'user', label: 'Perfil', name: 'profile', route: appRoutes.managerProfile },
];

export function ManagerBottomNavigation({ activeTab }: ManagerBottomNavigationProps) {
  const router = useRouter();

  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {NAVIGATION_ITEMS.map((item) => {
        const isActive = item.name === activeTab;

        return (
          <Pressable
            key={item.name}
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => {
              if (!isActive) {
                router.push(item.route);
              }
            }}
          >
            <DashboardIcon
              color={isActive ? colors.primary : colors.textMuted}
              name={item.icon}
              size={22}
            />
            <AppText
              color={isActive ? 'primary' : 'textMuted'}
              numberOfLines={1}
              style={styles.label}
              variant="label"
            >
              {item.label}
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
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  indicator: {
    borderRadius: 2,
    height: 3,
    marginTop: spacing.xs,
    width: 18,
  },
  indicatorActive: {
    backgroundColor: colors.primary,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 60,
    minWidth: 0,
    opacity: 1,
    paddingHorizontal: 2,
  },
  itemPressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0,
    lineHeight: 14,
    maxWidth: '100%',
  },
});
