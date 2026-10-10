import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/theme/ThemeProvider';

// System tab bar: the OS supplies the glass, reduce-transparency handling and press feedback.
// No tab-switch animation: it is seen dozens of times a day.
export default function TabLayout() {
  const { theme } = useTheme();
  return (
    <NativeTabs tintColor={theme.color.text.primary} labelStyle={{ fontFamily: 'JBMono-Medium', fontSize: 10 }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="spending">
        <NativeTabs.Trigger.Label>Spending</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assistant">
        <NativeTabs.Trigger.Label>Assistant</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="cards">
        <NativeTabs.Trigger.Label>Cards</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
