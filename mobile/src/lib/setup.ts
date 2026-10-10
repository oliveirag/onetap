import { router } from 'expo-router';

import type { OnboardingStep } from './types';

// The four setup steps after sign-up, in order (PRD F2).
export const SETUP: Exclude<OnboardingStep, 'done'>[] = ['connect', 'match', 'mode', 'card'];

export const setupProgress = (step: (typeof SETUP)[number]) => ({ index: SETUP.indexOf(step), total: SETUP.length });

// Back inside setup: pop if there's history, otherwise go to the step before (a resumed session
// starts mid-flow with nothing behind it).
export function backFrom(step: (typeof SETUP)[number]) {
  if (router.canGoBack()) router.back();
  else router.replace(`/${SETUP[Math.max(0, SETUP.indexOf(step) - 1)]}`);
}
