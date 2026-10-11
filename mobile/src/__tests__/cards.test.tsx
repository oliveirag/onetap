import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Cards from '@/app/(tabs)/cards';
import { mockStore } from '@/lib/mocks/store';
import { ThemeProvider } from '@/theme/ThemeProvider';

const ORIGINAL = ['card-amex', 'card-sapphire', 'card-citi', 'card-active'];

function renderCards() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Cards />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const rowNames = () => screen.getAllByTestId('card-row').map((r) => r.props.accessibilityLabel.split(',')[0]);

beforeEach(() => {
  mockStore.setCardOrder(ORIGINAL);
  mockStore.updateProfile({ default_card_id: 'card-active' });
});

it('lists cards in priority order and marks the default card', async () => {
  renderCards();
  await screen.findAllByTestId('card-row');
  expect(rowNames()).toEqual(['Amex Gold', 'Sapphire Preferred', 'Custom Cash', 'Active Cash']);
  expect(screen.getByLabelText(/^Active Cash, .*default card/)).toBeTruthy();
});

it('moves a card up with the VoiceOver action and saves the new order', async () => {
  renderCards();
  const [, sapphire] = await screen.findAllByTestId('card-row');
  act(() => {
    fireEvent(sapphire, 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
  });
  await waitFor(() => expect(rowNames()).toEqual(['Sapphire Preferred', 'Amex Gold', 'Custom Cash', 'Active Cash']));
  await waitFor(() => expect(mockStore.cards().map((c) => c.id)).toEqual(['card-sapphire', 'card-amex', 'card-citi', 'card-active']));
});

it('explains that card order breaks ties and that point balances are estimates', async () => {
  renderCards();
  expect(await screen.findByText(/Order breaks ties/)).toBeTruthy();
  expect(await screen.findByText('Point balances are demo estimates')).toBeTruthy();
});

it('lists one routing rule per category with the winning card', async () => {
  renderCards();
  expect(await screen.findByLabelText('Use Amex Gold for dining, 4x')).toBeTruthy();
  expect(screen.getByLabelText('Use Custom Cash for gas, 5x')).toBeTruthy();
  expect(screen.getByLabelText('Use Sapphire Preferred for travel, 5x')).toBeTruthy();
  expect(screen.getByLabelText('Use Active Cash for general, 2x')).toBeTruthy();
});

it('explains that rules wait while Manual is on', async () => {
  mockStore.updateProfile({ routing_mode: 'manual', manual_card_id: 'card-citi' });
  renderCards();
  expect(await screen.findByText(/Manual is on, so every purchase uses Custom Cash/)).toBeTruthy();
  mockStore.updateProfile({ routing_mode: 'auto', manual_card_id: null });
});

it('offers Plaid to connect cards when none are connected, and to add another bank otherwise', async () => {
  const cards = jest.spyOn(mockStore, 'cards').mockReturnValueOnce([]);
  const empty = renderCards();
  expect(await screen.findByText('No cards connected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Connect cards' })).toBeTruthy();
  empty.unmount();
  cards.mockRestore();

  renderCards();
  await screen.findAllByTestId('card-row');
  expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeTruthy();
});

it('shows the OneTap card standing in for the connected cards and links the physical card', async () => {
  renderCards();
  expect(await screen.findByText('Your OneTap card')).toBeTruthy();
  expect(await screen.findByText(/Stands in for your 4 connected cards/)).toBeTruthy();
  expect(await screen.findByText('Digital card ready. The physical card is not linked yet.')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Link physical card' }));
  expect(await screen.findByText('Hold your physical OneTap card on the reader.')).toBeTruthy();
  expect(await screen.findByText('Digital and physical card linked.', {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Link physical card' })).toBeNull();
});

it('freezes and unfreezes the OneTap card from its switch', async () => {
  renderCards();
  const toggle = await screen.findByRole('switch', { name: 'Freeze card' });
  fireEvent.press(toggle);
  expect(await screen.findByLabelText('OneTap card ending 4821, Frozen')).toBeTruthy();
  await waitFor(() => expect(mockStore.oneTapCard().state).toBe('paused'));
  fireEvent.press(screen.getByRole('switch', { name: 'Freeze card' }));
  await waitFor(() => expect(mockStore.oneTapCard().state).toBe('open'));
});
