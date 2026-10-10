import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

// Apple segmented control (2 to 5 options). Indicator slides 200ms in-out; content swaps instantly.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { theme, reduceMotion } = useTheme();
  const [width, setWidth] = useState(0);
  const pad = theme.space.xs;
  const segment = width > 0 ? (width - pad * 2) / options.length : 0;
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const indicator = useAnimatedStyle(() => ({
    transform: [
      { translateX: reduceMotion ? index * segment : withTiming(index * segment, { duration: duration.base, easing: ease.inOut }) },
    ],
  }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        padding: pad,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface.default,
        borderWidth: 1,
        borderColor: theme.color.border.default,
      }}
    >
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: pad,
              bottom: pad,
              left: pad,
              width: segment,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface.selected,
            },
            indicator,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => !selected && onChange(o.value)}
            style={{ flex: 1, minHeight: theme.controlHeight.sm, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="body-sm" tone={selected ? 'primary' : 'secondary'} style={{ fontFamily: selected ? 'JBMono-Medium' : 'JBMono-Regular' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
