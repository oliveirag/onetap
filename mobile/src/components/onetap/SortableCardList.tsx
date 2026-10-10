import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { haptics } from '@/lib/haptics';
import { indexForOffset, moveId, orderFromPositions, positionsFromOrder, type Positions } from '@/lib/reorder';
import type { UserCardRow } from '@/lib/types';
import { spring } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { CardArt } from './CardArt';

const ROW = 72;

type Props = {
  cards: UserCardRow[];
  defaultId: string | null;
  onReorder: (order: string[]) => void;
  onPressCard: (card: UserCardRow) => void;
};

// Hold a row to lift it; it tracks the finger 1:1 from where it was grabbed and the others spring
// out of the way. Everything runs on the UI thread; the new order is saved once, on release.
// VoiceOver users get Move up / Move down actions instead of the drag.
export function SortableCardList({ cards, defaultId, onReorder, onPressCard }: Props) {
  const order = cards.map((c) => c.id);
  const key = order.join(',');
  const positions = useSharedValue<Positions>(positionsFromOrder(order));
  const active = useSharedValue<string | null>(null);
  const dragTop = useSharedValue(0);

  useEffect(() => {
    positions.set(positionsFromOrder(key.split(',')));
  }, [key, positions]);

  const commit = (next: string[]) => {
    if (next.join(',') !== key) onReorder(next);
  };

  return (
    <View style={{ height: cards.length * ROW }}>
      {cards.map((card, i) => (
        <SortableRow
          key={card.id}
          card={card}
          index={i}
          count={cards.length}
          isDefault={card.id === defaultId}
          positions={positions}
          active={active}
          dragTop={dragTop}
          onCommit={commit}
          onMove={(to) => commit(moveId(order, card.id, to))}
          onPress={() => onPressCard(card)}
        />
      ))}
    </View>
  );
}

function SortableRow({
  card,
  index,
  count,
  isDefault,
  positions,
  active,
  dragTop,
  onCommit,
  onMove,
  onPress,
}: {
  card: UserCardRow;
  index: number;
  count: number;
  isDefault: boolean;
  positions: SharedValue<Positions>;
  active: SharedValue<string | null>;
  dragTop: SharedValue<number>;
  onCommit: (order: string[]) => void;
  onMove: (to: number) => void;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const start = useSharedValue(0);
  const id = card.id;
  const name = card.card_product?.name ?? card.account_name;
  const points = card.points_balance.toLocaleString('en-US');

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart(() => {
      start.set((positions.get()[id] ?? 0) * ROW);
      dragTop.set(start.get());
      active.set(id);
      scheduleOnRN(haptics.select);
    })
    .onUpdate((e) => {
      dragTop.set(start.get() + e.translationY);
      const to = indexForOffset(dragTop.get(), ROW, count);
      if (to !== positions.get()[id]) {
        positions.set(positionsFromOrder(moveId(orderFromPositions(positions.get()), id, to)));
      }
    })
    .onFinalize(() => {
      if (active.get() !== id) return;
      active.set(null); // the style below springs from where the finger let go to the slot
      scheduleOnRN(onCommit, orderFromPositions(positions.get()));
    });

  const page = theme.color.surface.page;
  const raised = theme.color.surface.raised;
  const style = useAnimatedStyle(() => {
    const dragging = active.get() === id;
    const slot = (positions.get()[id] ?? 0) * ROW;
    return {
      zIndex: dragging ? 1 : 0,
      // Lifted reads as one surface step up (dark mode has no shadows), not just 2% bigger.
      backgroundColor: dragging ? raised : page,
      transform: [
        { translateY: dragging ? dragTop.get() : withSpring(slot, spring.default) },
        { scale: withSpring(dragging ? 1.02 : 1, spring.default) },
      ],
    };
  });

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, right: 0, height: ROW }, style]}>
      <GestureDetector gesture={pan}>
        <Pressable
          testID="card-row"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${name}, ending ${card.mask}, ${points} points${isDefault ? ', default card' : ''}`}
          accessibilityHint="Hold and drag to change the order"
          accessibilityActions={[
            { name: 'moveUp', label: 'Move up' },
            { name: 'moveDown', label: 'Move down' },
          ]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'moveUp' && index > 0) onMove(index - 1);
            if (e.nativeEvent.actionName === 'moveDown' && index < count - 1) onMove(index + 1);
          }}
          // Highlight on touch-down: the tap opens a sheet, so the row must answer before release.
          style={({ pressed }) => ({
            height: ROW,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            backgroundColor: pressed ? theme.color.surface.hover : 'transparent',
            borderBottomWidth: 1,
            borderColor: theme.color.border.default,
          })}
        >
          <CardArt art={card.card_product?.card_art ?? 'solid'} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1}>{name}</Text>
            <Text variant="body-sm" tone="secondary" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
              •••• {card.mask}, {points} pts
            </Text>
          </View>
          {isDefault ? <Badge label="Default" icon="check" /> : null}
          <Icon name="grip" tone="tertiary" />
        </Pressable>
      </GestureDetector>
    </Animated.View>
  );
}
