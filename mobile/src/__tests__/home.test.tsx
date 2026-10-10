import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import Home from '@/app/(tabs)/index';
import { mockStore } from '@/lib/mocks/store';
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
  expect(await screen.findByLabelText('OneTap card ending 4821')).toBeTruthy();
  expect((await screen.findAllByText(/Sunshine Fuel|Knight Bites|Pegasus Market|StreamBox|Orlando Air|Lakeside Inn|Campus Books|Citrus Coffee/)).length).toBeGreaterThan(0);
});

it('prompts to choose a card in Manual mode when none is chosen', async () => {
  renderHome();
  fireEvent.press(await screen.findByRole('tab', { name: 'Manual' }));
  expect(await screen.findByText('Choose a card')).toBeTruthy();
});

it('shows the chosen card in Manual mode', async () => {
  mockStore.updateProfile({ routing_mode: 'manual', manual_card_id: 'card-citi' });
  renderHome();
  expect(await screen.findByText('Custom Cash')).toBeTruthy();
});
