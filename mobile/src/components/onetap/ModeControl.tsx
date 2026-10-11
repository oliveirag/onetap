import { ActionSheetIOS, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Segmented } from '@/components/ui/Segmented';
import { Text } from '@/components/ui/Text';
import { haptics } from '@/lib/haptics';
import { useProfile, useSetManualCard, useSetMode, useUserCards } from '@/lib/queries';
import type { RoutingMode } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { CardArt } from './CardArt';

// Auto/Manual toggle (PRD F7). In Manual the chosen card stays visible and changes in two taps.
export function ModeControl() {
  const { theme } = useTheme();
  const profile = useProfile();
  const cards = useUserCards();
  const setMode = useSetMode();
  const setManualCard = useSetManualCard();

  if (!profile.data) return null;
  const mode = profile.data.routing_mode;
  const chosen = cards.data?.find((c) => c.id === profile.data.manual_card_id);
  const usable = (cards.data ?? []).filter((c) => c.is_active);

  const pickCard = () => {
    const names = usable.map((c) => c.card_product?.name ?? c.account_name);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Use this card for every purchase', options: [...names, 'Cancel'], cancelButtonIndex: names.length },
      (i) => {
        if (i < names.length) {
          haptics.select();
          setManualCard.mutate(usable[i].id);
        }
      },
    );
  };

  return (
    <View style={{ gap: theme.space.md }}>
      <Segmented<RoutingMode>
        label="Routing mode"
        value={mode}
        onChange={(m) => {
          haptics.select();
          setMode.mutate(m);
        }}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'manual', label: 'Manual' },
        ]}
      />
      {mode === 'auto' ? null : chosen ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: theme.hitTarget }}>
          <CardArt art={chosen.card_product?.card_art ?? 'solid'} />
          <View style={{ flex: 1 }}>
            <Text>{chosen.card_product?.name ?? chosen.account_name}</Text>
            <Text variant="body-sm" tone="secondary">
              Every purchase
            </Text>
          </View>
          {/* Ghost buttons have no visible box: pull out by their padding so the label sits on the page margin. */}
          <View style={{ marginRight: -theme.space.lg }}>
            <Button variant="ghost" size="sm" label="Change" onPress={pickCard} />
          </View>
        </View>
      ) : (
        <PressableScale
          onPress={pickCard}
          hitSlop={0}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: theme.hitTarget }}
        >
          <Text style={{ flex: 1 }}>Choose a card</Text>
          <Icon name="chevron-right" tone="secondary" />
        </PressableScale>
      )}
    </View>
  );
}
