import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// A whole-form error (wrong password, no connection): icon plus words, never color alone.
export function FormError({ text }: { text: string | null }) {
  const { theme } = useTheme();
  if (!text) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ flexDirection: 'row', gap: theme.space.sm }}>
      <Icon name="alert" tone="error" />
      <Text tone="error" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
