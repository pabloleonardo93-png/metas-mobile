import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { LoginForm } from '@/features/auth/components/LoginForm';
import { LoginHeader } from '@/features/auth/components/LoginHeader';
import { AppText, ScreenContainer } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

export function LoginScreen() {
  const { height } = useWindowDimensions();
  const [entrance] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);
  const isCompactHeight = height < 780;
  const isShortHeight = height < 700;
  const panelOffset = Math.min(
    spacing.xxxl + spacing.sm,
    Math.max(
      isShortHeight ? spacing.xl : spacing.xxl,
      Math.round(height * (isShortHeight ? 0.06 : 0.075)),
    ),
  );

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotion(enabled);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const animation = Animated.timing(entrance, {
      duration: reduceMotion ? 0 : 320,
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [entrance, reduceMotion]);

  return (
    <ScreenContainer edges={['top', 'bottom']} style={styles.screen}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: panelOffset }]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.panel,
              {
                opacity: entrance,
                transform: [
                  {
                    translateY: entrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [reduceMotion ? 0 : 14, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View
              style={[
                styles.content,
                isCompactHeight && styles.contentCompact,
                isShortHeight && styles.contentShort,
              ]}
            >
              <LoginHeader compact={isShortHeight} />
              <LoginForm />
              <View style={styles.footer}>
                <View style={styles.divider} />
                <AppText color="textMuted" style={styles.footerText}>
                  Acesso exclusivo para{`\n`}colaboradores cadastrados.
                </AppText>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  contentCompact: {
    paddingBottom: spacing.lg,
    paddingTop: spacing.lg,
  },
  contentShort: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  footer: {
    gap: spacing.lg,
    marginTop: 'auto',
    paddingTop: spacing.sm,
  },
  footerText: {
    textAlign: 'center',
  },
  keyboardView: {
    flex: 1,
  },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    flexGrow: 1,
    overflow: 'hidden',
    ...shadows.panel,
  },
  screen: {
    backgroundColor: colors.primary,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
