import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useAccount, useCardProducts, useMatches, useMutations } from '@/lib/queries';
import { Badge, Button, Card, ErrorState, ListItem, Loading, Screen, SectionHeader, Text, TextField } from '@/components/ui';

export default function ConfirmProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAccount(id);
  const matches = useMatches(id);
  const [search, setSearch] = useState('');
  const products = useCardProducts(search);
  const m = useMutations();
  const choose = (cardProductId: string | null) => m.confirmProduct.mutate({ accountId: id, cardProductId }, { onSuccess: () => router.back() });

  return (
    <Screen edges={[]}>
      <Text muted>Which card is “{account.data?.name ?? '…'}”{account.data?.institutionName ? ` at ${account.data.institutionName}` : ''}? Reclaimed only suggests products from its small seeded list; you decide.</Text>
      {m.confirmProduct.error && <ErrorState error={m.confirmProduct.error} />}
      <SectionHeader title="Suggestions" />
      <Card>
        {matches.isLoading && <Loading />}
        {matches.data?.ambiguous && <Badge label="Ambiguous — please pick the exact product" tone="warning" />}
        {matches.data?.matches.length === 0 && <Text muted>No seeded product matches this account’s name. You can search below or leave it unconfirmed.</Text>}
        {matches.data?.matches.map((x) => (
          <ListItem key={x.product.id} icon="card-outline" title={x.product.productName} subtitle={`${x.reason} · ${Math.round(x.confidence * 100)}%`} onPress={() => choose(x.product.id)} />
        ))}
      </Card>
      <SectionHeader title="All seeded products" />
      <TextField label="Search products" value={search} onChangeText={setSearch} placeholder="e.g. Double Cash" autoCapitalize="none" />
      <Card>
        {products.data?.map((p) => (
          <ListItem key={p.id} testID={`product-${p.productSlug}`} icon="pricetag-outline" title={p.productName} subtitle={`${p.issuerName} · ${p.cardNetwork}`} right={account.data?.cardProduct?.id === p.id ? <Badge label="Current" tone="accent" /> : undefined} onPress={() => choose(p.id)} />
        ))}
      </Card>
      <Button title="Leave product unconfirmed" variant="ghost" onPress={() => choose(null)} />
    </Screen>
  );
}
