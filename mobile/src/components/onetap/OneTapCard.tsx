import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { OneTapLockup } from '@/components/brand/OneTapMark';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { brand } from '@/theme/brand';
import { useTheme } from '@/theme/ThemeProvider';

// The design's card is drawn 520 x 328 (ID-1, 85.6 x 54 mm); everything scales from that width.
const DESIGN_W = 520;
export const CARD_RATIO = 85.6 / 54;

// The physical card as the app draws it, from the One Tap identity: an ink face, the lockup top
// left, contactless top right, the last four bottom left. `back` is the expressive side: the mark
// blown up until the route bar runs off the edge. `status` says what the card does right now
// ("Best card, automatically" in Auto, "Always Amex Gold" in Manual).
export function OneTapCard({
  last4,
  status,
  auto = false,
  side = 'front',
  onLongPress,
}: {
  last4: string;
  status?: string;
  auto?: boolean;
  side?: 'front' | 'back';
  onLongPress?: () => void;
}) {
  const { theme } = useTheme();
  const [w, setW] = useState(0);
  // Until the first layout pass, assume a phone-width card so the face never renders blank.
  const k = (w || 350) / DESIGN_W;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const label = side === 'back' ? `Back of the OneTap card ending ${last4}` : `OneTap card ending ${last4}${status ? `, ${status}` : ''}`;

  const face = (
    <View
      accessible
      accessibilityLabel={label}
      onLayout={onLayout}
      style={{
        aspectRatio: CARD_RATIO,
        borderRadius: 19 * k,
        backgroundColor: brand.ink,
        // A hairline so the ink face still reads on a dark page.
        borderWidth: 1,
        borderColor: theme.color.border.default,
        overflow: 'hidden',
        justifyContent: 'space-between',
        paddingVertical: 30 * k,
      }}
    >
      {side === 'front' ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 32 * k }}>
            <OneTapLockup size={25 * k} />
            <Contactless size={28 * k} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space.md, paddingHorizontal: 32 * k }}>
            <Text allowFontScaling={false} style={{ color: brand.white, fontSize: 19 * k, letterSpacing: 0.14 * 19 * k, fontVariant: ['tabular-nums'] }}>
              •••• {last4}
            </Text>
            {status ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, flexShrink: 1 }}>
                {auto ? <Icon name="auto" size={13 * k * 1.3} color={brand.muted} /> : null}
                <Text allowFontScaling={false} numberOfLines={1} style={{ color: brand.muted, fontSize: 13 * k * 1.3, flexShrink: 1 }}>
                  {status}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      ) : (
        <>
          {/* Same 64:16 bar-to-offset and 9:14 gap-to-bar ratios as the logo. */}
          <View style={{ gap: 17 * k }}>
            <View style={{ height: 26 * k, width: 392 * k, backgroundColor: brand.quietBar, borderTopRightRadius: 6 * k, borderBottomRightRadius: 6 * k }} />
            <View style={{ height: 26 * k, marginLeft: 98 * k, backgroundColor: brand.route, borderTopLeftRadius: 6 * k, borderBottomLeftRadius: 6 * k }} />
            <View style={{ height: 26 * k, width: 392 * k, backgroundColor: brand.quietBar, borderTopRightRadius: 6 * k, borderBottomRightRadius: 6 * k }} />
          </View>
          <View style={{ paddingHorizontal: 32 * k, gap: 12 * k }}>
            <Text allowFontScaling={false} style={{ fontFamily: brand.wordmarkFont, color: brand.white, fontSize: 22 * k, letterSpacing: -0.03 * 22 * k }}>
              One card. All of yours.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 * k }}>
              <Text allowFontScaling={false} style={{ color: brand.muted, fontSize: 13 * k, lineHeight: 19 * k, flexShrink: 1 }}>
                Lost it? Freeze it in the One Tap app.
              </Text>
              <Text allowFontScaling={false} style={{ color: brand.muted, fontSize: 13 * k, fontVariant: ['tabular-nums'] }}>
                •••• {last4}
              </Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
  if (!onLongPress) return face;
  return (
    <PressableScale onLongPress={onLongPress} delayLongPress={400} hitSlop={0}>
      {face}
    </PressableScale>
  );
}

// The design's contactless glyph (three arcs), stroke only.
function Contactless({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={brand.white} strokeWidth={1.8} strokeLinecap="round" accessibilityElementsHidden>
      <Path d="M8.5 7.5a6 6 0 0 1 0 9" />
      <Path d="M12 5a10 10 0 0 1 0 14" />
      <Path d="M15.5 2.5a14 14 0 0 1 0 19" />
    </Svg>
  );
}
