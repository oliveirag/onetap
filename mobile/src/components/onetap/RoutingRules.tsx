import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { CATEGORIES } from '@/lib/categories';
import { formatMultiplier } from '@/lib/money';
import type { Rule } from '@/lib/rules';
import { useTheme } from '@/theme/ThemeProvider';
import { CardArt } from './CardArt';

// Curve's Smart Rules, but derived instead of written: one row per category, "Use <card> for
// <category>", read straight from the rates and the card order. Reordering cards updates ties live.
export function RoutingRules({ rules, manualName }: { rules: Rule[]; manualName?: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surface.default,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.color.border.default,
        paddingHorizontal: theme.space.lg,
        paddingVertical: theme.space.xs,
        opacity: manualName ? 0.6 : 1,
      }}
    >
      {rules.map((r, i) => {
        const category = CATEGORIES[r.category];
        const name = r.card.card_product?.name ?? r.card.account_name;
        const line = `Use ${name} for ${category.label.toLowerCase()}`;
        return (
          <View
            key={r.category}
            accessible
            accessibilityLabel={`${line}, ${formatMultiplier(r.multiplier)}${r.tie ? ', tie broken by card order' : ''}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.md,
              minHeight: 56,
              paddingVertical: theme.space.sm,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.color.border.default,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surface.raised,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={category.icon} tone="secondary" />
              </View>
              <Icon name="chevron-right" size={12} tone="tertiary" />
              <CardArt art={r.card.card_product?.card_art ?? 'solid'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="body-sm" numberOfLines={2}>
                {line}
              </Text>
              {r.tie ? (
                <Text variant="caption" tone="tertiary">
                  Tied, wins on card order
                </Text>
              ) : null}
            </View>
            <Text variant="body-sm" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMultiplier(r.multiplier)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
