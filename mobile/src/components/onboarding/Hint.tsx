import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

// Buttons stay enabled (DS rule); pressing one too early says what's missing, right above it.
export function Hint({ text }: { text: string | null }) {
  const { theme } = useTheme();
  if (!text) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
      <Icon name="info" size={14} tone="secondary" />
      <Text variant="body-sm" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
