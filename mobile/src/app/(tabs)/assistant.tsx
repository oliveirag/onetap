import { ScrollView } from 'react-native';

import { Empty } from '@/components/ui/States';
import { useTheme } from '@/theme/ThemeProvider';

// Replaced in Task 11 once the chat endpoint (Sultan) is live.
export default function Assistant() {
  const { theme } = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.color.surface.page }} contentContainerStyle={{ padding: theme.pageMargin }}>
      <Empty title="Assistant" body="Ask about your spending or plan a trip with your points. Connects once the chat service is live." />
    </ScrollView>
  );
}
