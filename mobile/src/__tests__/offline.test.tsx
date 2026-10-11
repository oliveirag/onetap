import { useNetInfo } from '@react-native-community/netinfo';
import { render, screen } from '@testing-library/react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/OfflineBanner';
import { ThemeProvider } from '@/theme/ThemeProvider';

const net = useNetInfo as jest.Mock;
const renderBanner = () =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ThemeProvider>
        <OfflineBanner />
      </ThemeProvider>
    </SafeAreaProvider>,
  );

it('says so while offline', () => {
  net.mockReturnValue({ isConnected: false, isInternetReachable: false });
  renderBanner();
  expect(screen.getByText('You are offline. Showing saved activity.')).toBeTruthy();
});

it('stays hidden while connectivity is unknown or online', () => {
  net.mockReturnValue({ isConnected: null, isInternetReachable: null });
  renderBanner();
  expect(screen.queryByText(/offline/)).toBeNull();
});
