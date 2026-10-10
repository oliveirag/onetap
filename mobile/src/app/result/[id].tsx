import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Money } from '@/components/ui/Money';
import { Text } from '@/components/ui/Text';
import { useTransaction } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

// Placeholder: the receipt replaces this in Task 6.
export default function Result() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tx = useTransaction(id);
  return (
    <View style={{ padding: theme.pageMargin, gap: theme.space.sm }}>
      <Text variant="h3">{tx.data?.merchant_name ?? ''}</Text>
      {tx.data ? <Money cents={tx.data.reward_value_cents} reward variant="display" /> : null}
    </View>
  );
}
