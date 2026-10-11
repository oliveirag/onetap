import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { brand } from '@/theme/brand';

// The mark: three cards in your wallet; the one that earns the most (the route bar) slides forward.
// Geometry is the design's 80 x 60 grid: 64 x 14 bars, 3.5 radius, 16 offset, 9 gap.
export function OneTapMark({ height = 18, bars = brand.white, route = brand.route }: { height?: number; bars?: string; route?: string }) {
  return (
    <Svg width={(height * 80) / 60} height={height} viewBox="0 0 80 60" accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={0} y={0} width={64} height={14} rx={3.5} fill={bars} />
      <Rect x={16} y={23} width={64} height={14} rx={3.5} fill={route} />
      <Rect x={0} y={46} width={64} height={14} rx={3.5} fill={bars} />
    </Svg>
  );
}

// Mark + "One Tap" set in Geist SemiBold with the design's tight tracking. Logo art, not UI text,
// so it is the one place outside JetBrains Mono.
export function OneTapLockup({ size = 24, color = brand.white }: { size?: number; color?: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="One Tap" style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.44 }}>
      <OneTapMark height={size * 0.75} bars={color} />
      <Text
        allowFontScaling={false}
        style={{ fontFamily: brand.wordmarkFont, fontSize: size, letterSpacing: -0.035 * size, lineHeight: size * 1.1, color }}
      >
        One Tap
      </Text>
    </View>
  );
}
