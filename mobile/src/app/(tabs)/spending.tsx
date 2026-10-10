import { ScrollView } from 'react-native';

import { Empty } from '@/components/ui/States';
import { useTheme } from '@/theme/ThemeProvider';

// Replaced by the Spending view in Task 9.
export default function Spending() {
  const { theme } = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.color.surface.page }} contentContainerStyle={{ padding: theme.pageMargin }}>
      <Empty title="Spending" body="Totals by category and card land here next." />
    </ScrollView>
  );
}
