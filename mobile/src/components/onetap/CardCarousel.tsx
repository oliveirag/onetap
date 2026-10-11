import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { OneTapCard } from './OneTapCard';

const PEEK = 28; // how much of the next card shows at the edge: the swipe affordance, no label needed
const GAP = 12;

export type CardCarouselHandle = { show: (page: 0 | 1) => void };

// The OneTap card's two forms side by side, after Revolut's card picker: the digital card, then the
// physical one with the next card peeking in from the right edge. Native paging scroll, no custom
// gesture. Full bleed, so the peek runs to the screen edge.
export const CardCarousel = forwardRef<
  CardCarouselHandle,
  { last4: string; status?: string; auto?: boolean; created: boolean; physicalLinked: boolean }
>(function CardCarousel({ last4, status, auto, created, physicalLinked }, ref) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const cardW = width - theme.pageMargin * 2 - PEEK;
  const step = cardW + GAP;

  useImperativeHandle(ref, () => ({
    show: (p) => {
      scroll.current?.scrollTo({ x: p * step, animated: true });
      setPage(p);
    },
  }));

  const pages = [
    { title: 'Digital card', state: created ? 'Ready to use' : 'Not created yet', dim: !created },
    { title: 'Physical card', state: physicalLinked ? 'Linked' : 'Not linked yet', dim: !physicalLinked },
  ];

  return (
    <View style={{ gap: theme.space.sm }}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={step}
        disableIntervalMomentum
        style={{ marginHorizontal: -theme.pageMargin }}
        contentContainerStyle={{ paddingHorizontal: theme.pageMargin, gap: GAP }}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / step) as 0 | 1)}
      >
        {pages.map((p, i) => (
          <View key={p.title} accessible style={{ width: cardW, opacity: p.dim ? 0.55 : 1 }} accessibilityLabel={`${p.title}, ${p.state}`}>
            <OneTapCard last4={last4} side={i === 0 ? 'front' : 'back'} status={i === 0 ? status : undefined} auto={auto} />
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
        <Text style={{ fontFamily: 'JBMono-Medium' }}>
          {pages[page].title}
          <Text tone="secondary">{`, ${pages[page].state.toLowerCase()}`}</Text>
        </Text>
        <View accessible accessibilityLabel={`Card ${page + 1} of 2`} style={{ flexDirection: 'row', gap: theme.space.xs }}>
          {pages.map((p, i) => (
            <View key={p.title} style={{ width: i === page ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? theme.color.text.primary : theme.color.border.strong }} />
          ))}
        </View>
      </View>
    </View>
  );
});
