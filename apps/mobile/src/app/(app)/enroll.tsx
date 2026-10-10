import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useEnrollment, useHardwareStatus, useMutations } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { Badge, Button, Card, ErrorState, Screen, Text, TextField } from '@/components/ui';

export default function Enroll() {
  const { colors } = useTheme();
  const hw = useHardwareStatus();
  const m = useMutations();
  const [nickname, setNickname] = useState('My test card');
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const e = useEnrollment(enrollmentId);
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1.12, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const reader = hw.data?.readers.find((r) => r.connected);
  const status = e.data?.status;

  return (
    <Screen edges={['bottom']}>
      <Card>
        <Text variant="label" muted>READER</Text>
        <Badge label={reader ? `${reader.model ?? reader.readerName} connected` : 'No connected reader — start the hardware bridge'} tone={reader ? 'success' : 'warning'} />
      </Card>
      {!enrollmentId && (
        <>
          <TextField label="Nickname" value={nickname} onChangeText={setNickname} maxLength={40} />
          {m.startEnrollment.error && <ErrorState error={m.startEnrollment.error} />}
          <Button title="Start enrollment" loading={m.startEnrollment.isPending} onPress={() => m.startEnrollment.mutate({ nickname, readerId: reader?.id }, { onSuccess: (d) => setEnrollmentId(d.id) })} testID="start-enrollment" />
          <Text variant="caption" muted>Generic NFC UIDs can be copied, so enrolled cards are development test identities only — never real-money credentials.</Text>
        </>
      )}
      {enrollmentId && (
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
          {status === 'PENDING' || !status ? (
            <>
              <Animated.View style={anim}><Ionicons name="radio-outline" size={72} color={colors.accent} /></Animated.View>
              <Text variant="title">Tap your card</Text>
              <Text muted style={{ textAlign: 'center' }}>Place the generic NFC card on the ACR1252U now.</Text>
              {e.data && <Text variant="caption" muted>Expires {new Date(e.data.expiresAt).toLocaleTimeString()}</Text>}
              <Button title="Cancel" variant="ghost" onPress={() => { m.cancelEnrollment.mutate(enrollmentId); router.back(); }} />
            </>
          ) : status === 'COMPLETED' ? (
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Ionicons name="checkmark-circle" size={72} color={colors.success} />
              <Text variant="title">Card enrolled</Text>
              <Button title="Done" onPress={() => router.back()} />
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Ionicons name="close-circle" size={72} color={colors.danger} />
              <Text variant="title">Enrollment {status.toLowerCase()}</Text>
              <Text muted>{e.data?.failureReason === 'CARD_ALREADY_ENROLLED' ? 'That card is already enrolled.' : 'Please try again.'}</Text>
              <Button title="Try again" onPress={() => setEnrollmentId(null)} />
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}
