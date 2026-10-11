import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { spring } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

const TRACK_W = 52;
const TRACK_H = 32;
const KNOB = 26;
const TRAVEL = TRACK_W - KNOB - 6;

// Label leads, switch trails. Knob springs (no bounce), is interruptible, and can be dragged:
// it tracks the finger 1:1 and the release velocity decides the side.
export function Toggle({ value, onValueChange, label, description }: { value: boolean; onValueChange: (v: boolean) => void; label: string; description?: string }) {
  const { theme } = useTheme();
  const x = useSharedValue(value ? TRAVEL : 0);
  const start = useSharedValue(0);

  useEffect(() => {
    x.set(withSpring(value ? TRAVEL : 0, spring.default));
  }, [value, x]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      start.set(x.get());
    })
    .onUpdate((e) => {
      x.set(Math.min(TRAVEL, Math.max(0, start.get() + e.translationX)));
    })
    .onEnd((e) => {
      const on = e.velocityX !== 0 ? e.velocityX > 0 : x.get() > TRAVEL / 2;
      // Carry the flick into the settle; clamp so the knob never passes the track's edge.
      x.set(withSpring(on ? TRAVEL : 0, { ...spring.default, velocity: e.velocityX, overshootClamping: true }));
      if (on !== value) scheduleOnRN(onValueChange, on);
    });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onValueChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: theme.hitTarget }}
    >
      <View style={{ flex: 1, gap: theme.space.xs }}>
        <Text>{label}</Text>
        {description ? <Text variant="body-sm" tone="secondary">{description}</Text> : null}
      </View>
      <GestureDetector gesture={pan}>
        <View
          style={{
            width: TRACK_W,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            borderWidth: 1,
            borderColor: value ? theme.color.border.action : theme.color.border.control,
            backgroundColor: value ? theme.color.surface.action : theme.color.surface.field,
            padding: 2,
          }}
        >
          <Animated.View
            style={[
              {
                width: KNOB,
                height: KNOB,
                borderRadius: KNOB / 2,
                backgroundColor: value ? theme.color.text['on-action'] : theme.color.text.secondary,
              },
              knob,
            ]}
          />
        </View>
      </GestureDetector>
    </Pressable>
  );
}
