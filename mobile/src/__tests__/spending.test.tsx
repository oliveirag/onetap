import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import Spending from '@/app/(tabs)/spending';
import { mockStore } from '@/lib/mocks/store';
import { aggregate } from '@/lib/spending';
import { formatCents } from '@/lib/money';
import { ThemeProvider } from '@/theme/ThemeProvider';

function renderSpending() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Spending />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

it('shows the month total, rewards and the demo-history label', async () => {
  const expected = aggregate(mockStore.transactions(), mockStore.cards());
  renderSpending();
  expect(await screen.findByText(formatCents(expected.totalSpendCents))).toBeTruthy();
  expect(screen.getByText(`+${formatCents(expected.rewardsCents)}`)).toBeTruthy();
  expect(screen.getByText('Includes demo history')).toBeTruthy();
});

it('lists categories largest first, each with its value as text', async () => {
  const expected = aggregate(mockStore.transactions(), mockStore.cards());
  renderSpending();
  const top = expected.byCategory[0];
  expect(await screen.findByLabelText(new RegExp(`^${top.label}, ${formatCents(top.cents).replace('$', '\\$')}`))).toBeTruthy();
});

it('lists spend by card', async () => {
  renderSpending();
  expect(await screen.findByText('By card')).toBeTruthy();
  expect(screen.getAllByText(/Amex Gold|Sapphire Preferred|Custom Cash|Active Cash/).length).toBeGreaterThan(0);
});
