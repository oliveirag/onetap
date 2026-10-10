import type { TapEvent } from '@shared/contracts';
import { Text, View } from 'react-native';

// Placeholder until Task 5. The type import proves @shared resolves in tsc and Metro.
const sample: TapEvent['source'] = 'fake_tap';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#171717' }}>
      <Text style={{ color: '#FAFAFA' }}>Reclaimed {sample}</Text>
    </View>
  );
}
