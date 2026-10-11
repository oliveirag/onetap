import { router } from 'expo-router';
import { useMemo } from 'react';
import { Share, View } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { Text } from '@/components/ui/Text';
import { formatMultiplier, formatReward } from '@/lib/money';
import { buildPlan, fixesFor, progressOf, shareText } from '@/lib/onboarding';
import { useTheme } from '@/theme/ThemeProvider';

// Value delivery, built from their answers: what routing earns on purchases like theirs (priced on
// three popular cards, labeled), the fixes for what they said gets in the way, and the rule per
// category. Their real cards connect with Plaid after sign-up. Creating the account keeps the plan.
export default function PlanScreen() {
  const { theme } = useTheme();
  const { answers } = useAnswers();
  const plan = useMemo(() => buildPlan(answers), [answers]);
  const extra = plan.totalCents - plan.oneCardCents;

  return (
    <FlowScreen
      title="Your OneTap plan"
      subtitle={
        extra > 0
          ? `On ${plan.purchases.length} purchases like yours, OneTap earns ${formatReward(extra)} more than using ${plan.oneCardName} for everything.`
          : 'Connect your cards after you sign up to see where each purchase would go.'
      }
      progress={progressOf('plan')}
      footer={
        <>
          <Button label="Save my plan" onPress={() => router.push('/name')} />
          <Button variant="secondary" icon="share" label="Share" onPress={() => Share.share({ message: shareText(plan) }).catch(() => {})} />
        </>
      }
    >
      <View
        style={{
          flexDirection: 'row',
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.color.border.default,
          backgroundColor: theme.color.surface.default,
          padding: theme.space.lg,
          gap: theme.space.lg,
        }}
      >
        <View style={{ flex: 1 }}>
          <Money cents={plan.totalCents} reward variant="h2" />
          <Text variant="body-sm" tone="secondary">
            With OneTap
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Money cents={plan.oneCardCents} reward variant="h2" tone="tertiary" />
          <Text variant="body-sm" tone="secondary" numberOfLines={1}>
            {plan.oneCardName} alone
          </Text>
        </View>
      </View>

      <View style={{ gap: theme.space.md }}>
        <Text variant="h4" accessibilityRole="header">
          What changes for you
        </Text>
        {fixesFor(answers.pains).map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', gap: theme.space.md }}>
            <Icon name={p.icon} size={18} />
            <Text style={{ flex: 1 }}>{p.fix}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: theme.space.xs }}>
        <Text variant="h4" accessibilityRole="header" style={{ marginBottom: theme.space.sm }}>
          Where each purchase goes
        </Text>
        {plan.rules.map((r) => (
          <View
            key={r.category}
            accessible
            accessibilityLabel={`${r.label}: ${r.cardName}, ${formatMultiplier(r.multiplier)}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: theme.hitTarget }}
          >
            <Icon name={r.icon} size={18} tone="secondary" />
            <Text style={{ width: 96 }} tone="secondary">
              {r.label}
            </Text>
            <Text style={{ flex: 1, fontFamily: 'JBMono-Medium' }} numberOfLines={1}>
              {r.cardName}
            </Text>
            <Text style={{ fontVariant: ['tabular-nums'] }}>{formatMultiplier(r.multiplier)}</Text>
          </View>
        ))}
      </View>
      <DemoLabel text="Example with three popular cards. Reward rates are estimates" />
    </FlowScreen>
  );
}
