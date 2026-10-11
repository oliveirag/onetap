import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import Home from '@/app/(tabs)/index';
import { groupByDay } from '@/lib/feed';
import { mockStore } from '@/lib/mocks/store';
import { formatCents } from '@/lib/money';
import { aggregate } from '@/lib/spending';
import { ThemeProvider } from '@/theme/ThemeProvider';

function renderHome() {
  // gcTime Infinity: no cache timers left running after the test, so Jest can exit.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Home />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockStore.updateProfile({ routing_mode: 'auto', manual_card_id: null });
});

it('shows the OneTap card and recent activity from the feed', async () => {
  renderHome();
  expect(await screen.findByLabelText('OneTap card ending 4821, Best card, automatically')).toBeTruthy();
  expect((await screen.findAllByText(/Sunshine Fuel|Knight Bites|Pegasus Market|StreamBox|Orlando Air|Lakeside Inn|Campus Books|Citrus Coffee/)).length).toBeGreaterThan(0);
});

it('prompts to choose a card in Manual mode when none is chosen', async () => {
  renderHome();
  fireEvent.press(await screen.findByRole('tab', { name: 'Manual' }));
  // Once on the card face, once as the picker row.
  expect((await screen.findAllByText('Choose a card')).length).toBe(2);
});

it('shows the chosen card in Manual mode', async () => {
  mockStore.updateProfile({ routing_mode: 'manual', manual_card_id: 'card-citi' });
  renderHome();
  expect(await screen.findByText('Custom Cash')).toBeTruthy();
  expect(screen.getByLabelText('OneTap card ending 4821, Always Custom Cash')).toBeTruthy();
});

it("shows this month's spend and rewards, matching the Spending tab", async () => {
  const s = aggregate(mockStore.transactions(), mockStore.cards());
  renderHome();
  expect(await screen.findByLabelText(formatCents(s.totalSpendCents))).toBeTruthy();
  expect(screen.getByLabelText(`plus ${formatCents(s.extraCents)}`)).toBeTruthy();
  expect(screen.getByText('Spent this month')).toBeTruthy();
  expect(screen.getByText('Reclaimed this month')).toBeTruthy();
  expect(screen.getByText(`${formatCents(s.rewardsCents)} earned in rewards. Reclaimed is what routing earned beyond your default card.`)).toBeTruthy();
});

it('projects the yearly reclaimed value from the demo history, labeled as an estimate', async () => {
  const s = aggregate(mockStore.transactions(), mockStore.cards());
  expect(s.projectionDollars).toBeGreaterThan(0);
  renderHome();
  expect(await screen.findByText(`On pace to reclaim about $${s.projectionDollars!.toLocaleString('en-US')} a year.`)).toBeTruthy();
  expect(screen.getByText('Includes demo history · yearly figure is an estimate')).toBeTruthy();
});

it('groups activity under day headers, newest first', async () => {
  const days = groupByDay(mockStore.transactions().slice(0, 20));
  renderHome();
  await screen.findByText(days[0].label);
  const labels = screen.getAllByRole('header').map((h) => h.props.children);
  expect(labels).toEqual(expect.arrayContaining(days.map((d) => d.label)));
  expect(labels.indexOf(days[0].label)).toBeLessThan(labels.indexOf(days[days.length - 1].label));
});
