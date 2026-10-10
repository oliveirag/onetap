import { ScrollView } from 'react-native';

import { Empty } from '@/components/ui/States';
import { useTheme } from '@/theme/ThemeProvider';

// Replaced by the Cards tab in Task 10.
export default function Cards() {
  const { theme } = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.color.surface.page }} contentContainerStyle={{ padding: theme.pageMargin }}>
      <Empty title="Cards" body="Your connected cards and their order land here next." />
    </ScrollView>
  );
}
