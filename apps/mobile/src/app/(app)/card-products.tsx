import { useState } from 'react';
import { useCardProducts } from '@/lib/queries';
import { Card, EmptyState, ErrorState, ListItem, Loading, Screen, Text, TextField } from '@/components/ui';

export default function CardProducts() {
  const [search, setSearch] = useState('');
  const q = useCardProducts(search);
  return (
    <Screen edges={[]}>
      <Text muted>Phase 1 ships a small seeded list of popular cards. It contains names and networks only — no rewards data.</Text>
      <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Issuer or product" autoCapitalize="none" testID="product-search" />
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} />}
      <Card>
        {q.data?.length === 0 && <EmptyState title="No products match" />}
        {q.data?.map((p) => <ListItem key={p.id} icon="pricetag-outline" title={p.productName} subtitle={`${p.issuerName} · ${p.cardNetwork}`} />)}
      </Card>
    </Screen>
  );
}
