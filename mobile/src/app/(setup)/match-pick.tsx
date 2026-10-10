import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { Choice } from '@/components/onboarding/Choice';
import { FormError } from '@/components/onboarding/FormError';
import { CardArt } from '@/components/onetap/CardArt';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { CATALOG, OTHER_CARD } from '@/lib/catalog';
import { useSetCardProduct, useUserCards } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';

// Native sheet: search on top, catalog products, then "Other card". Picking one saves and closes.
export default function MatchPick() {
  const { theme } = useTheme();
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const cards = useUserCards();
  const setProduct = useSetCardProduct();
  const [q, setQ] = useState('');
  const card = cards.data?.find((c) => c.id === cardId);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = CATALOG.filter((p) => !needle || `${p.issuer} ${p.name}`.toLowerCase().includes(needle));
    return [...hits, OTHER_CARD];
  }, [q]);

  const pick = (productId: string) => {
    setProduct.mutate({ cardId, productId }, { onSuccess: () => router.back() });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.pageMargin, gap: theme.space.md }}>
      <View style={{ gap: theme.space.xs }}>
        <Text variant="h3" accessibilityRole="header">
          Which card is this?
        </Text>
        {card ? (
          <Text tone="secondary">
            {card.account_name} •••• {card.mask}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
          minHeight: theme.controlHeight.md,
          paddingHorizontal: theme.space.md,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.color.border.control,
          backgroundColor: theme.color.surface.field,
        }}
      >
        <Icon name="search" tone="secondary" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search cards"
          placeholderTextColor={theme.color.text.tertiary}
          accessibilityLabel="Search cards"
          autoCorrect={false}
          style={[theme.type.body, { flex: 1, color: theme.color.text.primary }]}
        />
      </View>
      <FormError text={setProduct.error ? "That change didn't save. Try again." : null} />
      <View accessibilityRole="radiogroup" accessibilityLabel="Card products" style={{ gap: theme.space.sm }}>
        {options.map((p) => (
          <Choice
            key={p.id}
            label={p.is_generic ? 'Other card' : p.name}
            description={p.is_generic ? '1x on everything' : p.issuer}
            leading={<CardArt art={p.card_art} />}
            selected={card?.card_product_id === p.id}
            onPress={() => pick(p.id)}
          />
        ))}
      </View>
    </ScrollView>
  );
}
