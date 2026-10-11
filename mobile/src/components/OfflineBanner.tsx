import { useNetInfo } from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

// Floats over every screen while the phone has no connection; TanStack Query keeps showing cached
// data and refetches on reconnect. Never blocks touches. Fades only: it explains a state change.
export function OfflineBanner() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const net = useNetInfo();
  // null means "not known yet": only a definite false counts, so launch never flashes the banner.
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const was = useRef(false);

  useEffect(() => {
    if (offline === was.current) return;
    was.current = offline;
    AccessibilityInfo.announceForAccessibility(offline ? 'You are offline. Showing saved activity.' : 'Back online.');
  }, [offline]);

  if (!offline) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(duration.base).easing(ease.out)}
      exiting={FadeOut.duration(duration.fast).easing(ease.out)}
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + theme.space.sm, left: theme.pageMargin, right: theme.pageMargin, alignItems: 'center' }}
    >
      <View
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
          paddingVertical: theme.space.sm,
          paddingHorizontal: theme.space.md,
          borderRadius: theme.radius.full,
          borderWidth: 1,
          borderColor: theme.color.border.strong,
          backgroundColor: theme.color.surface.raised,
        }}
      >
        <Icon name="offline" />
        <Text variant="body-sm" style={{ flexShrink: 1 }}>
          You are offline. Showing saved activity.
        </Text>
      </View>
    </Animated.View>
  );
}
