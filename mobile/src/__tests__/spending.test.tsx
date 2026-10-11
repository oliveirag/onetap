import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import Dashboard from '@/app/(tabs)/spending';
import { summarizeCards } from '@/lib/dashboard';
import { missedRewards } from '@/lib/missed';
import { mockStore } from '@/lib/mocks/store';
import { aggregate } from '@/lib/spending';
import { formatCents } from '@/lib/money';
import { ThemeProvider } from '@/theme/ThemeProvider';

function renderSpending() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

it('shows the month total across connected cards, OneTap rewards and the sandbox label', async () => {
  const cards = summarizeCards(mockStore.cardSpending());
  const onetap = aggregate(mockStore.transactions(), mockStore.cards());
  renderSpending();
  // Totals roll digit by digit, so each is one accessible element read by its label.
  expect(await screen.findByLabelText(formatCents(cards.totalSpendCents))).toBeTruthy();
  expect(screen.getByText(`${cards.purchases} purchases on ${cards.cardCount} cards`)).toBeTruthy();
  expect(screen.getByLabelText(`plus ${formatCents(onetap.rewardsCents)}`)).toBeTruthy();
  expect(screen.getByText('Plaid sandbox transactions')).toBeTruthy();
});


it('lists categories largest first, each with its value as text', async () => {
  const expected = summarizeCards(mockStore.cardSpending());
  renderSpending();
  const top = expected.byCategory[0];
  expect(await screen.findByLabelText(new RegExp(`^${top.label}, ${formatCents(top.cents).replace('$', '\\$')}`))).toBeTruthy();
});

it('lists spend by card', async () => {
  renderSpending();
  expect(await screen.findByText('By card')).toBeTruthy();
  expect(screen.getAllByText(/American Express Gold Card|Chase Sapphire Preferred|Citi Custom Cash Card|Wells Fargo Active Cash Card/).length).toBeGreaterThan(0);
});

it('starts on the largest category and moves the selection when another row is tapped', async () => {
  const expected = summarizeCards(mockStore.cardSpending());
  const [top, second] = expected.byCategory;
  const row = (c: { label: string; cents: number }) => new RegExp(`^${c.label}, ${formatCents(c.cents).replace('$', '\\$')}`);
  renderSpending();

  expect((await screen.findByRole('button', { name: row(top) })).props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(screen.getByRole('button', { name: row(second) }));
  expect(screen.getByRole('button', { name: row(second) }).props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByRole('button', { name: row(top) }).props.accessibilityState).toEqual({ selected: false });
});

it('shows what the connected cards left on the table and the insight sentence', async () => {
  const missed = missedRewards(mockStore.cardSpending(), mockStore.cards(), mockStore.rates())!;
  const { insight } = aggregate(mockStore.transactions(), mockStore.cards());
  expect(missed.missedCents).toBeGreaterThan(0);
  renderSpending();
  expect(await screen.findByText('Left on the table this month')).toBeTruthy();
  expect(screen.getByLabelText(formatCents(missed.missedCents))).toBeTruthy();
  expect(screen.getByText(insight!.sentence)).toBeTruthy();
});
