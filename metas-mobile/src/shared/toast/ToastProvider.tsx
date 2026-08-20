import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, AppText, type AppIconName } from '@/shared/components';
import { ToastContext } from '@/shared/toast/ToastContext';
import {
  createToastController,
  type ToastMessage,
  type ToastType,
} from '@/shared/toast/toastController';
import { colors, radius, shadows, spacing } from '@/shared/theme';

const TOAST_APPEARANCE: Record<
  ToastType,
  { backgroundColor: string; borderColor: string; color: string; icon: AppIconName }
> = {
  error: {
    backgroundColor: colors.errorSubtle,
    borderColor: colors.error,
    color: colors.error,
    icon: 'alert-circle',
  },
  info: {
    backgroundColor: colors.primarySubtle,
    borderColor: colors.primary,
    color: colors.primary,
    icon: 'info',
  },
  success: {
    backgroundColor: colors.successSubtle,
    borderColor: colors.success,
    color: colors.success,
    icon: 'check-circle',
  },
};

function ToastHost({ toast }: { toast: ToastMessage | null }) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;

  const appearance = TOAST_APPEARANCE[toast.type];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        accessibilityLiveRegion={toast.type === 'error' ? 'assertive' : 'polite'}
        accessibilityRole="alert"
        pointerEvents="none"
        style={[
          styles.toast,
          {
            backgroundColor: appearance.backgroundColor,
            borderColor: appearance.borderColor,
            top: insets.top + spacing.sm,
          },
        ]}
      >
        <AppIcon color={appearance.color} name={appearance.icon} size={22} />
        <AppText style={[styles.message, { color: appearance.color }]} variant="bodyMedium">
          {toast.message}
        </AppText>
      </View>
    </View>
  );
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [controller] = useState(createToastController);
  const [toast, setToast] = useState<ToastMessage | null>(controller.getCurrent());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setToast);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const value = useMemo(
    () => ({
      hideToast: () => controller.hide(),
      showToast: controller.show,
    }),
    [controller],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toast={toast} />
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  message: {
    flex: 1,
  },
  toast: {
    ...shadows.card,
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    elevation: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    maxWidth: 680,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    position: 'absolute',
    right: spacing.md,
    zIndex: 1_000,
  },
});
