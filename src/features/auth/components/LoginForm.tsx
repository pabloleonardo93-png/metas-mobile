import { useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { LoginField, LoginFormValues } from '@/features/auth/types/login';
import { getEmailError, getPasswordError } from '@/features/auth/utils/validation';
import { AppButton, AppText, AppTextInput } from '@/shared/components';
import { colors, iconSizes, spacing } from '@/shared/theme';

const initialValues: LoginFormValues = { email: '', password: '' };

function FieldIcon({ name }: { name: 'email' | 'lock' }) {
  const path =
    name === 'email'
      ? 'M3 6.5A3.5 3.5 0 0 1 6.5 3h11A3.5 3.5 0 0 1 21 6.5v11a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 17.5v-11Zm1 0 8 6 8-6'
      : 'M7 10V7a5 5 0 0 1 10 0v3m-10 0h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm5 5v3';

  return (
    <Svg height={iconSizes.md} viewBox="0 0 24 24" width={iconSizes.md}>
      <Path
        d={path}
        fill="none"
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </Svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <Svg height={iconSizes.md} viewBox="0 0 24 24" width={iconSizes.md}>
      <Path
        d={
          visible
            ? 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'
            : 'm3 3 18 18M9.8 6.7A8.8 8.8 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a18.3 18.3 0 0 1-3.4 3.7M6.2 8.1A18.6 18.6 0 0 0 2.5 12s3.5 5.5 9.5 5.5c.8 0 1.5-.1 2.2-.3M9.9 9.9a3 3 0 0 0 4.2 4.2'
        }
        fill="none"
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </Svg>
  );
}

export function LoginForm() {
  const passwordRef = useRef<TextInput>(null);
  const [values, setValues] = useState<LoginFormValues>(initialValues);
  const [touched, setTouched] = useState<Record<LoginField, boolean>>({
    email: false,
    password: false,
  });
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const errors = useMemo(
    () => ({ email: getEmailError(values.email), password: getPasswordError(values.password) }),
    [values],
  );
  const isValid = !errors.email && !errors.password;

  function updateValue(field: LoginField, value: string) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function markTouched(field: LoginField) {
    setTouched((currentTouched) => ({ ...currentTouched, [field]: true }));
  }

  function handleSubmit() {
    setTouched({ email: true, password: true });

    if (!isValid) {
      return;
    }

    Keyboard.dismiss();
    Alert.alert('Em breve', 'A autenticação será conectada ao servidor em uma próxima etapa.');
  }

  return (
    <View style={styles.form}>
      <AppTextInput
        accessibilityLabel="Seu e-mail"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        error={touched.email ? errors.email : undefined}
        inputMode="email"
        keyboardType="email-address"
        leftAdornment={<FieldIcon name="email" />}
        placeholder="Seu e-mail"
        returnKeyType="next"
        textContentType="emailAddress"
        value={values.email}
        onBlur={() => markTouched('email')}
        onChangeText={(value) => updateValue('email', value)}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />

      <AppTextInput
        ref={passwordRef}
        accessibilityLabel="Sua senha"
        autoCapitalize="none"
        autoComplete="current-password"
        error={touched.password ? errors.password : undefined}
        leftAdornment={<FieldIcon name="lock" />}
        placeholder="Sua senha"
        returnKeyType="done"
        rightAdornment={
          <Pressable
            accessibilityLabel={isPasswordVisible ? 'Ocultar senha' : 'Mostrar senha'}
            accessibilityRole="button"
            accessibilityState={{ checked: isPasswordVisible }}
            hitSlop={spacing.sm}
            style={styles.visibilityButton}
            onPress={() => setIsPasswordVisible((currentValue) => !currentValue)}
          >
            <EyeIcon visible={isPasswordVisible} />
            <AppText color="primary" style={styles.visibilityLabel} variant="label">
              {isPasswordVisible ? 'Ocultar' : 'Mostrar'}
            </AppText>
          </Pressable>
        }
        secureTextEntry={!isPasswordVisible}
        textContentType="password"
        value={values.password}
        onBlur={() => markTouched('password')}
        onChangeText={(value) => updateValue('password', value)}
        onSubmitEditing={handleSubmit}
      />

      <Pressable
        accessibilityLabel="Esqueci minha senha"
        accessibilityRole="link"
        style={styles.forgotPassword}
        onPress={() =>
          Alert.alert(
            'Em breve',
            'A recuperação de senha será disponibilizada em uma próxima etapa.',
          )
        }
      >
        <AppText color="primary" variant="bodyMedium">
          Esqueci minha senha
        </AppText>
      </Pressable>

      <AppButton
        accessibilityHint={
          isValid
            ? 'Envia o formulário de login'
            : 'Preencha um e-mail válido e uma senha de seis caracteres'
        }
        disabled={!isValid}
        label="Entrar"
        onPress={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  forgotPassword: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  form: {
    gap: spacing.md,
  },
  visibilityButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  visibilityLabel: {
    fontSize: 15,
  },
});
