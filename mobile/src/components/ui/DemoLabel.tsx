import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

// The one quiet style for anything simulated (PRD F11): info icon + caption, tertiary.
export function DemoLabel({ text = 'Demo data' }: { text?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }} accessible accessibilityLabel={text}>
      <Icon name="info" size={12} tone="tertiary" />
      <Text variant="caption" tone="tertiary">
        {text}
      </Text>
    </View>
  );
}
