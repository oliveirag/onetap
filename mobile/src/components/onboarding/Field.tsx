import { forwardRef, useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// DS Input: label above (required asterisk before it), `border.control` edge at 3:1, focus ring,
// and an error that is an icon plus a message saying what to do. Passwords get a show/hide eye.
export const Field = forwardRef<TextInput, TextInputProps & { label: string; required?: boolean; error?: string | null; password?: boolean }>(
  function Field({ label, required = false, error, password = false, style, onFocus, onBlur, ...rest }, ref) {
    const { theme } = useTheme();
    const c = theme.color;
    const [focused, setFocused] = useState(false);
    const [hidden, setHidden] = useState(true);
    const edge = error ? c.border.error : focused ? c.border.focus : c.border.control;

    return (
      <View style={{ gap: theme.space.xs }}>
        <Text variant="body-sm" tone="secondary">
          {required ? '* ' : ''}
          {label}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: theme.controlHeight.lg,
            borderRadius: theme.radius.md,
            borderWidth: focused || error ? 2 : 1,
            borderColor: edge,
            backgroundColor: c.surface.field,
            // Keep the text from shifting when the edge thickens on focus.
            paddingHorizontal: focused || error ? theme.space.md - 1 : theme.space.md,
          }}
        >
          <TextInput
            ref={ref}
            {...rest}
            accessibilityLabel={label}
            accessibilityHint={error ?? undefined}
            secureTextEntry={password && hidden}
            placeholderTextColor={c.text.tertiary}
            selectionColor={c.text.primary}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            style={[theme.type.body, { flex: 1, color: c.text.primary, paddingVertical: theme.space.sm }, style]}
          />
          {password ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
              onPress={() => setHidden((h) => !h)}
              style={{ width: theme.hitTarget, height: theme.hitTarget, alignItems: 'center', justifyContent: 'center', marginRight: -theme.space.sm }}
            >
              <Icon name={hidden ? 'eye' : 'eye-off'} size={18} tone="secondary" />
            </PressableScale>
          ) : null}
        </View>
        {error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }} accessibilityRole="alert">
            <Icon name="alert" size={14} tone="error" />
            <Text variant="body-sm" tone="error" style={{ flex: 1 }}>
              {error}
            </Text>
          </View>
        ) : null}
      </View>
    );
  },
);
