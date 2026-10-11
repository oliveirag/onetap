import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

type Face = 'idle' | 'confirming' | 'pending' | 'done' | 'error';

const CONFIRM_TIMEOUT = 6000; // an unanswered question returns to rest
const RESULT_TIMEOUT = 5000; // a result stays this long, then rests
const OPEN_GUARD = 280; // a second tap this soon after opening is a double tap, not a yes

// The container eases to each face's size; faces cross-fade. Reanimated skips both under
// reduced motion (ReduceMotion.System), so the face simply swaps.
const resize = LinearTransition.duration(duration.base).easing(ease.out);
const faceIn = FadeIn.duration(duration.fast).easing(ease.out);
const faceOut = FadeOut.duration(100).easing(ease.out);

// Arc's confirm morph for RN: a resting button that turns into an inline question in place,
// then a spinner, then the result. No modal, no alert. Errors offer Retry.
export function ConfirmMorph({
  label,
  prompt,
  confirmLabel,
  pendingLabel,
  doneLabel,
  errorLabel,
  onConfirm,
  variant = 'ghost',
  confirmTone = 'destructive',
  block = false,
}: {
  label: string;
  prompt: string;
  confirmLabel: string;
  pendingLabel: string;
  doneLabel: string;
  errorLabel: string;
  onConfirm: () => Promise<unknown>;
  // The resting button's look; `secondary` gives it a visible box.
  variant?: 'ghost' | 'secondary' | 'primary';
  // Destructive for sign out; primary for a constructive action like creating a card.
  confirmTone?: 'destructive' | 'primary';
  // Full width (a footer action): the question stacks Confirm over Go back, like Revolut's inline confirm.
  block?: boolean;
}) {
  const { theme } = useTheme();
  const [face, setFace] = useState<Face>('idle');
  const openedAt = useRef(0);

  useEffect(() => {
    const wait = face === 'confirming' ? CONFIRM_TIMEOUT : face === 'done' || face === 'error' ? RESULT_TIMEOUT : 0;
    if (!wait) return;
    const t = setTimeout(() => setFace('idle'), wait);
    return () => clearTimeout(t);
  }, [face]);

  // Announce once per face change. Labels can tick (a countdown in pendingLabel), so read them from a ref.
  const labels = useRef({ prompt, pendingLabel, doneLabel, errorLabel });
  useEffect(() => {
    labels.current = { prompt, pendingLabel, doneLabel, errorLabel };
  });
  useEffect(() => {
    const l = labels.current;
    const said = { confirming: l.prompt, pending: l.pendingLabel, done: l.doneLabel, error: l.errorLabel, idle: '' }[face];
    if (said) AccessibilityInfo.announceForAccessibility(said);
  }, [face]);

  const open = () => {
    openedAt.current = Date.now();
    setFace('confirming');
  };

  const run = async () => {
    if (Date.now() - openedAt.current < OPEN_GUARD) return;
    setFace('pending');
    try {
      await onConfirm();
      setFace('done');
    } catch {
      setFace('error');
    }
  };

  const row = { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, minHeight: theme.controlHeight.md } as const;

  return (
    <Animated.View layout={resize} style={{ alignSelf: block ? 'stretch' : 'flex-start', maxWidth: '100%' }}>
      {face === 'idle' ? (
        <Animated.View key="idle" entering={faceIn} exiting={faceOut}>
          <Button variant={variant} label={label} onPress={open} />
        </Animated.View>
      ) : face === 'confirming' ? (
        <Animated.View key="confirming" entering={faceIn} exiting={faceOut} accessibilityRole="alert" style={{ gap: theme.space.sm }}>
          <Text variant="body-sm">{prompt}</Text>
          {block ? (
            <>
              <Button variant={confirmTone} label={confirmLabel} onPress={run} />
              <Button variant="secondary" label="Go back" onPress={() => setFace('idle')} />
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
              <Button variant="secondary" size="sm" label="Cancel" onPress={() => setFace('idle')} />
              <Button variant={confirmTone} size="sm" label={confirmLabel} onPress={run} />
            </View>
          )}
        </Animated.View>
      ) : face === 'pending' ? (
        <Animated.View key="pending" entering={faceIn} exiting={faceOut} accessibilityState={{ busy: true }} style={row}>
          <ActivityIndicator color={theme.color.icon.secondary} />
          <Text variant="body-sm" tone="secondary" style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}>
            {pendingLabel}
          </Text>
        </Animated.View>
      ) : face === 'done' ? (
        <Animated.View key="done" entering={faceIn} exiting={faceOut} style={row}>
          <Icon name="check" tone="secondary" />
          <Text variant="body-sm" tone="secondary">
            {doneLabel}
          </Text>
        </Animated.View>
      ) : (
        <Animated.View key="error" entering={faceIn} exiting={faceOut} style={row}>
          <Icon name="alert" tone="error" />
          <Text variant="body-sm" tone="error" style={{ flexShrink: 1 }}>
            {errorLabel}
          </Text>
          <Button variant="secondary" size="sm" label="Retry" onPress={run} />
        </Animated.View>
      )}
    </Animated.View>
  );
}
