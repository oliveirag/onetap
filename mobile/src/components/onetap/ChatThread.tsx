import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string };

const messageIn = FadeIn.duration(duration.base).easing(ease.out);

// Arc's grouped thread, trimmed to what the Assistant needs: no avatars, reactions, receipts
// or attachments. Consecutive messages from one side sit close; a new speaker gets room.
// Only the newest message fades in, so switching modes never replays the whole thread.
export function MessageList({ messages, animateId }: { messages: ChatMessage[]; animateId: string | null }) {
  const { theme } = useTheme();
  return (
    <View accessibilityRole="list" accessibilityLabel="Conversation">
      {messages.map((m, i) => {
        const user = m.role === 'user';
        const groupStart = i === 0 || messages[i - 1].role !== m.role;
        return (
          <Animated.View
            key={m.id}
            entering={m.id === animateId ? messageIn : undefined}
            accessible
            accessibilityLabel={`${user ? 'You' : 'Assistant'}: ${m.text}`}
            style={{
              alignSelf: user ? 'flex-end' : 'flex-start',
              maxWidth: user ? '85%' : '100%',
              marginTop: i === 0 ? 0 : groupStart ? theme.space.lg : theme.space.xs,
              ...(user && {
                backgroundColor: theme.color.surface.default,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
              }),
            }}
          >
            <Text variant="body">{m.text}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

function Dot({ index, color }: { index: number; color: string }) {
  const { reduceMotion } = useTheme();
  const o = useSharedValue(0.6);

  useEffect(() => {
    if (reduceMotion) return;
    o.set(0.3);
    const step = { duration: 400, easing: ease.linear };
    o.set(withDelay(index * 150, withRepeat(withSequence(withTiming(1, step), withTiming(0.3, step)), -1)));
    return () => cancelAnimation(o);
  }, [index, reduceMotion, o]);

  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }, style]} />;
}

// Waiting on a reply. The app's only looping motion: a linear opacity pulse, static under reduced motion.
export function TypingDots() {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Assistant is writing"
      style={{ flexDirection: 'row', gap: theme.space.xs, paddingVertical: theme.space.sm, marginTop: theme.space.lg }}
    >
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} color={theme.color.icon.secondary} />
      ))}
    </View>
  );
}

// Grows to six lines, sends on return. Send is never disabled: with nothing typed it focuses the box.
// `onSend` returns false to refuse (a reply is still on its way), and the draft stays put.
export function Composer({ onSend, placeholder }: { onSend: (text: string) => boolean; placeholder: string }) {
  const { theme } = useTheme();
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);
  const lineHeight = theme.type.body.lineHeight ?? 20;

  const send = () => {
    const t = text.trim();
    if (!t) return input.current?.focus();
    if (onSend(t)) setText('');
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: theme.space.sm,
        paddingHorizontal: theme.pageMargin,
        paddingVertical: theme.space.sm,
        borderTopWidth: 1,
        borderTopColor: theme.color.border.default,
        backgroundColor: theme.color.surface.page,
      }}
    >
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        submitBehavior="submit"
        returnKeyType="send"
        multiline
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        selectionColor={theme.color.text.primary}
        style={[
          theme.type.body,
          {
            flex: 1,
            color: theme.color.text.primary,
            maxHeight: lineHeight * 6 + theme.space.sm * 2,
            minHeight: theme.controlHeight.md,
            paddingHorizontal: theme.space.md,
            paddingTop: theme.space.sm + 2,
            paddingBottom: theme.space.sm + 2,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.color.border.control,
            backgroundColor: theme.color.surface.field,
          },
        ]}
      />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Send"
        onPress={send}
        style={{
          width: theme.controlHeight.md,
          height: theme.controlHeight.md,
          borderRadius: theme.radius.full,
          backgroundColor: theme.color.surface.action,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="arrow-up" tone="on-action" />
      </PressableScale>
    </View>
  );
}
