import * as Haptics from 'expo-haptics';

// Only two haptics exist in the app (utility rule): the routing result arriving, and a mode change.
export const haptics = {
  resultArrived: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  select: () => Haptics.selectionAsync(),
};
