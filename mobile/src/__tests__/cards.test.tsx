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
