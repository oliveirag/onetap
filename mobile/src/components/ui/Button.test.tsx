import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { Button } from './Button';

it('renders its label as an accessible button and fires onPress', () => {
  const onPress = jest.fn();
  render(
    <ThemeProvider>
      <Button label="Connect cards" onPress={onPress} />
    </ThemeProvider>,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Connect cards' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('meets the 44pt minimum height on mobile', () => {
  render(
    <ThemeProvider>
      <Button label="Save" onPress={() => {}} />
    </ThemeProvider>,
  );
  expect(screen.getByRole('button')).toHaveStyle({ minHeight: 44 });
});

it('ignores presses while loading', () => {
  const onPress = jest.fn();
  render(
    <ThemeProvider>
      <Button label="Save" onPress={onPress} loading />
    </ThemeProvider>,
  );
  fireEvent.press(screen.getByRole('button'));
  expect(onPress).not.toHaveBeenCalled();
});
