import type { IconName } from '@/components/ui/iconNames';
import type { CategoryId } from './types';

export const CATEGORIES: Record<CategoryId, { label: string; icon: IconName }> = {
  dining: { label: 'Dining', icon: 'dining' },
  groceries: { label: 'Groceries', icon: 'cart' },
  gas: { label: 'Gas', icon: 'fuel' },
  streaming: { label: 'Streaming', icon: 'play' },
  travel: { label: 'Travel', icon: 'plane' },
  general: { label: 'General', icon: 'tag' },
};
