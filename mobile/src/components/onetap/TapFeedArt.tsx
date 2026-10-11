import { View } from 'react-native';

import { OneTapMark } from '@/components/brand/OneTapMark';
import { useTheme } from '@/theme/ThemeProvider';

// Three stacked banners, the newest in front: every tap lands on the phone as it happens.
// After Revolut's notification pre-prompt, drawn in grey steps only (no color, no glass).
export function TapFeedArt() {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 176,
          height: 48,
          borderRadius: 12,
          backgroundColor: c.surface.action,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          gap: 10,
          zIndex: 2,
        }}
      >
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: c.surface.page, alignItems: 'center', justifyContent: 'center' }}>
          <OneTapMark height={12} bars={c.text.primary} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 6, width: '70%', borderRadius: 3, backgroundColor: c.text['on-action'], opacity: 0.85 }} />
          <View style={{ height: 6, width: '45%', borderRadius: 3, backgroundColor: c.text['on-action'], opacity: 0.4 }} />
        </View>
      </View>
      <View style={{ width: 156, height: 16, marginTop: 4, borderRadius: 8, backgroundColor: c.border.strong }} />
      <View style={{ width: 132, height: 14, marginTop: 4, borderRadius: 7, backgroundColor: c.border.default }} />
    </View>
  );
}
