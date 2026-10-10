import { SymbolView, type SFSymbol } from 'expo-symbols';

import { useTheme } from '@/theme/ThemeProvider';
import type { IconName } from './iconNames';

export type { IconName };

// Every name verified with the SF Symbols catalog (iOS 15+).
const SF: Record<IconName, SFSymbol> = {
  plus: 'plus',
  'arrow-right': 'arrow.right',
  'arrow-left': 'arrow.left',
  'arrow-up': 'arrow.up',
  check: 'checkmark',
  x: 'xmark',
  'chevron-down': 'chevron.down',
  'chevron-right': 'chevron.right',
  alert: 'exclamationmark.triangle',
  info: 'info.circle',
  search: 'magnifyingglass',
  minus: 'minus',
  user: 'person',
  home: 'house',
  chart: 'chart.bar',
  chat: 'bubble.left',
  cards: 'creditcard',
  dining: 'fork.knife',
  cart: 'cart',
  fuel: 'fuelpump',
  play: 'play.rectangle',
  plane: 'airplane',
  tag: 'tag',
  grip: 'line.3.horizontal',
  auto: 'wand.and.stars',
  eye: 'eye',
  'eye-off': 'eye.slash',
  lock: 'lock',
  mail: 'envelope',
  sparkles: 'sparkles',
  clock: 'clock',
  bolt: 'bolt',
  share: 'square.and.arrow.up',
  tap: 'wave.3.right',
  'thumbs-up': 'hand.thumbsup',
  'thumbs-down': 'hand.thumbsdown',
  question: 'questionmark.circle',
  student: 'graduationcap',
};

type Tone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'on-action' | 'action';

// Decorative by default: the label next to an icon carries the meaning for VoiceOver.
export function Icon({ name, size = 16, tone = 'primary', color }: { name: IconName; size?: number; tone?: Tone; color?: string }) {
  const { theme } = useTheme();
  return (
    <SymbolView
      name={SF[name]}
      size={size}
      weight="regular"
      tintColor={color ?? theme.color.icon[tone]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    />
  );
}
