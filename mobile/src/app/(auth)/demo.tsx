import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Hint } from '@/components/onboarding/Hint';
import { Button } from '@/components/ui/Button';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Enter } from '@/components/ui/Enter';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { Text } from '@/components/ui/Text';
import { CATEGORIES } from '@/lib/categories';
import { haptics } from '@/lib/haptics';
import { formatMultiplier, formatReward } from '@/lib/money';
import { buildPlan, progressOf, type DemoPurchase } from '@/lib/onboarding';
import { useTheme } from '@/theme/ThemeProvider';

// The app demo: the real core loop in miniature. They tap each purchase like at the register and
// the result lands the way the live receipt does (same haptic, same "where it went" line).
export default function Demo() {
  const { theme } = useTheme();
  const { answers } = useAnswers();
  const plan = useMemo(() => buildPlan(answers), [answers]);
  const [tapped, setTapped] = useState<Set<number>>(new Set());
  const [hint, setHint] = useState<string | null>(null);
  const left = plan.purchases.length - tapped.size;

  const tap = (i: number) => {
    if (tapped.has(i)) return;
    haptics.resultArrived();
    setHint(null);
    setTapped(new Set(tapped).add(i));
  };

  return (
    <FlowScreen
      title="Try a tap"
      subtitle="Tap each purchase like you would at the register. Watch which card it goes to."
      progress={progressOf('demo')}
      footer={
        <>
          <Hint text={hint} />
          <Button
            label="See my plan"
            onPress={() => (left ? setHint(`Tap the other ${left === 1 ? 'purchase' : `${left} purchases`} first.`) : router.push('/plan'))}
          />
        </>
      }
    >
      <View style={{ gap: theme.space.md }}>
        {plan.purchases.map((p, i) => (
          <Purchase key={p.merchant.id} p={p} oneCard={plan.oneCardName} done={tapped.has(i)} onTap={() => tap(i)} />
        ))}
      </View>
      <View style={{ gap: theme.space.xs }}>
        <Text variant="caption" tone="tertiary">
          {left ? `${left} to go` : 'All done'}
        </Text>
        <DemoLabel text={plan.sample ? 'Sample wallet. Reward rates are estimates' : 'Reward rates are estimates'} />
      </View>
    </FlowScreen>
  );
}

function Purchase({ p, oneCard, done, onTap }: { p: DemoPurchase; oneCard: string; done: boolean; onTap: () => void }) {
  const { theme } = useTheme();
  const cat = CATEGORIES[p.merchant.category_id];
  return (
    <View
      style={{
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: done ? theme.color.border.strong : theme.color.border.default,
        backgroundColor: theme.color.surface.default,
        padding: theme.space.md,
        gap: theme.space.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <Icon name={cat.icon} size={20} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'JBMono-Medium' }}>{p.merchant.name}</Text>
          <Text variant="body-sm" tone="secondary">
            {cat.label}
          </Text>
        </View>
        <Money cents={p.merchant.amount_cents} />
      </View>

      {done ? (
        // The receipt line arrives (rare moment): down 8px and in, 250ms out-ease. Opacity only under reduced motion.
        <Enter
          kind="drop"
          style={{ borderTopWidth: 1, borderTopColor: theme.color.border.default, paddingTop: theme.space.md, gap: theme.space.xs }}
        >
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
            <Text style={{ flex: 1 }}>
              <Text tone="secondary">Went to </Text>
              <Text style={{ fontFamily: 'JBMono-Medium' }}>{p.cardName}</Text>
              <Text tone="secondary"> · {formatMultiplier(p.multiplier)}</Text>
            </Text>
            <Money cents={p.valueCents} reward variant="h4" />
          </View>
          <Text variant="body-sm" tone="tertiary">
            {p.valueCents > p.oneCardValueCents
              ? `${oneCard} alone would earn ${formatReward(p.oneCardValueCents)}`
              : `${oneCard} alone earns the same here`}
          </Text>
        </Enter>
      ) : (
        <Button variant="secondary" icon="tap" label="Tap to pay" onPress={onTap} />
      )}
    </View>
  );
}
