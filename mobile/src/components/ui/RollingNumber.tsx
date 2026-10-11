import { useEffect } from 'react';
import { View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { TypeName } from '@/theme/resolve';
import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { Text, type TextTone } from './Text';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Every glyph sits in a box exactly one line tall. iOS draws a Text a little shorter than its
// lineHeight, so without the box the strip drifts by a fraction of a line per digit.
function Cell({ ch, variant, tone, lineHeight }: { ch: string; variant: TypeName; tone: TextTone; lineHeight: number }) {
  return (
    <View style={{ height: lineHeight, justifyContent: 'center' }}>
      <Text variant={variant} tone={tone} style={NUM}>
        {ch}
      </Text>
    </View>
  );
}

// One digit as a 0-9 strip behind a one-line window. Only translateY moves, on the UI thread.
// First render sits still; later changes roll 250ms in-out. Reduced motion swaps in place.
function DigitColumn({ digit, variant, tone, lineHeight }: { digit: number; variant: TypeName; tone: TextTone; lineHeight: number }) {
  const { reduceMotion } = useTheme();
  const y = useSharedValue(-digit * lineHeight);

  useEffect(() => {
    const target = -digit * lineHeight;
    y.set(reduceMotion ? target : withTiming(target, { duration: duration.modal, easing: ease.inOut }));
  }, [digit, lineHeight, reduceMotion, y]);

  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  return (
    <View style={{ height: lineHeight, overflow: 'hidden' }}>
      <Animated.View style={strip}>
        {DIGITS.map((d) => (
          <Cell key={d} ch={d} variant={variant} tone={tone} lineHeight={lineHeight} />
        ))}
      </Animated.View>
    </View>
  );
}

const NUM: TextStyle = { fontVariant: ['tabular-nums'] };

// Formatted text whose digits roll to the new value (Arc's rolling readout, rebuilt for RN).
// Digits are tabular (fontVariant), so every column is the same width and nothing reflows.
// Columns are keyed from the right, so $9.99 -> $10.00 keeps the cents columns in place.
export function RollingNumber({
  text,
  variant = 'body',
  tone = 'primary',
  accessibilityLabel,
}: {
  text: string;
  variant?: TypeName;
  tone?: TextTone;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const lineHeight = theme.type[variant].lineHeight ?? 20;
  const chars = [...text];

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? text} style={{ flexDirection: 'row' }}>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <DigitColumn key={`d${key}`} digit={Number(ch)} variant={variant} tone={tone} lineHeight={lineHeight} />
        ) : (
          <Cell key={`s${key}${ch}`} ch={ch} variant={variant} tone={tone} lineHeight={lineHeight} />
        );
      })}
    </View>
  );
}
