import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { segmentsFor } from '@/components/onetap/SpendDonut';
import { ConfirmMorph } from '@/components/ui/ConfirmMorph';
import { RollingNumber } from '@/components/ui/RollingNumber';
import { ThemeProvider } from '@/theme/ThemeProvider';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RollingNumber', () => {
  it('reads as the whole value and keeps every digit on screen', () => {
    wrap(<RollingNumber text="$1,234.56" accessibilityLabel="$1,234.56" />);
    expect(screen.getByLabelText('$1,234.56')).toBeTruthy();
  });
});

describe('segmentsFor', () => {
  it('splits the ring by share with a gap between arcs and none for a single part', () => {
    const two = segmentsFor([
      { id: 'a', label: 'A', cents: 300 },
      { id: 'b', label: 'B', cents: 100 },
    ]);
    expect(two[0].sweep).toBeGreaterThan(two[1].sweep * 2.9);
    expect(two[1].start).toBeGreaterThan(two[0].start + two[0].sweep);
    const one = segmentsFor([{ id: 'a', label: 'A', cents: 100 }]);
    expect(one[0].sweep).toBeCloseTo(Math.PI * 2);
    expect(segmentsFor([])).toEqual([]);
  });
});

describe('ConfirmMorph', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const props = {
    label: 'Sign out',
    prompt: 'Sign out of OneTap on this phone?',
    confirmLabel: 'Sign out now',
    pendingLabel: 'Signing out',
    doneLabel: 'Signed out',
    errorLabel: 'Sign out did not finish.',
  };

  it('asks in place, ignores a double tap, then shows the result', async () => {
    const onConfirm = jest.fn(() => Promise.resolve());
    wrap(<ConfirmMorph {...props} onConfirm={onConfirm} />);

    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByText(props.prompt)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Sign out now' }));
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(300));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign out now' })));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Signed out')).toBeTruthy();

    act(() => jest.advanceTimersByTime(5000));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('goes back to rest on Cancel or when the question is left unanswered', () => {
    wrap(<ConfirmMorph {...props} onConfirm={() => Promise.resolve()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(props.prompt)).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    act(() => jest.advanceTimersByTime(6000));
    expect(screen.queryByText(props.prompt)).toBeNull();
  });

  it('shows the error with Retry when the action fails', async () => {
    const onConfirm = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    wrap(<ConfirmMorph {...props} onConfirm={onConfirm} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    act(() => jest.advanceTimersByTime(300));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign out now' })));
    expect(screen.getByText(props.errorLabel)).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Retry' })));
    expect(screen.getByText('Signed out')).toBeTruthy();
  });
});

