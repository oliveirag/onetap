import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';

import { TransactionListener } from '@/components/TransactionListener';
import { haptics } from '@/lib/haptics';
import { mockEmitter } from '@/lib/mocks/emitter';
import { mockCards, mockProfile, routeMock, MERCHANTS } from '@/lib/mocks/fixtures';
import { keys } from '@/lib/queries';
import type { TransactionRow } from '@/lib/types';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockPath = '/';
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a) },
  usePathname: () => mockPath,
}));
jest.mock('@/lib/haptics', () => ({ haptics: { resultArrived: jest.fn(), select: jest.fn() } }));

const fresh = (id: string): TransactionRow => routeMock(MERCHANTS[0], mockCards, mockProfile, new Date(), id);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TransactionListener userId={null} />
    </QueryClientProvider>,
  );
  return { client, view };
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  (haptics.resultArrived as jest.Mock).mockClear();
  mockPath = '/';
});

it('opens the receipt and buzzes once per transaction, even if the event repeats', async () => {
  const { client } = setup();
  await waitFor(() => expect(client.getQueryData(keys.transactions)).toBeDefined());
  act(() => mockEmitter.emit(fresh('a')));
  act(() => mockEmitter.emit(fresh('a')));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: 'a' } });
  expect(haptics.resultArrived).toHaveBeenCalledTimes(1);
});

it('replaces an open receipt instead of stacking a second sheet', async () => {
  const { client, view } = setup();
  await waitFor(() => expect(client.getQueryData(keys.transactions)).toBeDefined());
  mockPath = '/result/a';
  view.rerender(
    <QueryClientProvider client={client}>
      <TransactionListener userId={null} />
    </QueryClientProvider>,
  );
  act(() => mockEmitter.emit(fresh('b')));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: 'b' } });
  expect(mockPush).not.toHaveBeenCalled();
});

it('never opens for seeded history already in the feed', async () => {
  const { client } = setup();
  await waitFor(() => expect(client.getQueryData(keys.transactions)).toBeDefined());
  expect(mockPush).not.toHaveBeenCalled();
});

it('opens for a fresh row that arrives through a refetch (offline during the tap)', async () => {
  const { client } = setup();
  await waitFor(() => expect(client.getQueryData(keys.transactions)).toBeDefined());
  act(() => {
    client.setQueryData<TransactionRow[]>(keys.transactions, (old = []) => [fresh('c'), ...old]);
  });
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: 'c' } }));
  expect(haptics.resultArrived).toHaveBeenCalledTimes(1);
});
