import { useEffect } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { RollingNumber } from '@/components/ui/RollingNumber';
import { Text } from '@/components/ui/Text';
import { formatCents } from '@/lib/money';
import { duration, ease } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 208;
const THICKNESS = 24;
const R = (SIZE - THICKNESS) / 2; // stroke runs along the mid radius
const C = SIZE / 2;
const GAP = 2 / R; // 2pt surface gap between arcs, measured at the mid radius
const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;

type Row = { id: string; label: string; cents: number };
type Segment = { id: string; start: number; sweep: number };

function arcPath(start: number, sweep: number) {
  'worklet';
  // A full-circle arc has equal endpoints and draws nothing, so stop just short of it.
  const s = Math.max(0.0001, Math.min(sweep, TAU - 0.0001));
  const x0 = C + R * Math.cos(start);
  const y0 = C + R * Math.sin(start);
  const x1 = C + R * Math.cos(start + s);
  const y1 = C + R * Math.sin(start + s);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${s > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

export function segmentsFor(rows: Row[]): Segment[] {
  const total = rows.reduce((sum, r) => sum + r.cents, 0);
  if (total <= 0) return [];
  const gap = rows.length > 1 ? GAP : 0;
  let at = TOP;
  return rows.map((r) => {
    const share = (r.cents / total) * TAU;
    const seg = { id: r.id, start: at + gap / 2, sweep: Math.max(0, share - gap) };
    at += share;
    return seg;
  });
}

// One arc. Start and sweep tween on the UI thread when the data changes (250ms in-out),
// so shares visibly shift when a purchase lands. Reduced motion jumps straight there.
function Arc({ start, sweep, color }: { start: number; sweep: number; color: string }) {
  const { reduceMotion } = useTheme();
  const a = useSharedValue(start);
  const s = useSharedValue(sweep);

  useEffect(() => {
    const cfg = { duration: duration.modal, easing: ease.inOut };
    a.set(reduceMotion ? start : withTiming(start, cfg));
    s.set(reduceMotion ? sweep : withTiming(sweep, cfg));
  }, [start, sweep, reduceMotion, a, s]);

  const props = useAnimatedProps(() => ({ d: arcPath(a.get(), s.get()) }));
  return <AnimatedPath animatedProps={props} stroke={color} strokeWidth={THICKNESS} fill="none" />;
}

// Share of spend by category (Arc's donut, achromatic). Every arc is one neutral ink; the active
// one is primary, so identity never rests on hue. The center rolls to the active category.
// The ring is decorative for VoiceOver: the bars below are the legend and the table.
export function SpendDonut({ rows, activeId, onSelect }: { rows: Row[]; activeId: string; onSelect: (id: string) => void }) {
  const { theme } = useTheme();
  const segments = segmentsFor(rows);
  const total = rows.reduce((sum, r) => sum + r.cents, 0);
  const active = rows.find((r) => r.id === activeId) ?? rows[0];

  const onPress = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const dx = locationX - C;
    const dy = locationY - C;
    const dist = Math.hypot(dx, dy);
    if (dist < R - THICKNESS / 2 - 8 || dist > R + THICKNESS / 2 + 8) return;
    let angle = Math.atan2(dy, dx);
    if (angle < TOP) angle += TAU;
    const hit = segments.find((seg) => angle >= seg.start - GAP && angle <= seg.start + seg.sweep + GAP);
    if (hit && hit.id !== activeId) onSelect(hit.id);
  };

  if (!active || total <= 0) return null;
  const pct = Math.round((active.cents / total) * 100);

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable
        onPress={onPress}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: SIZE, height: SIZE }}
      >
        <Svg width={SIZE} height={SIZE}>
          {segments.map((seg) => (
            <Arc
              key={seg.id}
              start={seg.start}
              sweep={seg.sweep}
              color={seg.id === active.id ? theme.color.icon.primary : theme.color.icon.tertiary}
            />
          ))}
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: theme.space.xs }}>
          <Text variant="body-sm" tone="secondary" numberOfLines={1}>
            {active.label}
          </Text>
          <RollingNumber text={formatCents(active.cents)} variant="h3" />
          <Text variant="caption" tone="tertiary">
            {`${pct}% of spend`}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
