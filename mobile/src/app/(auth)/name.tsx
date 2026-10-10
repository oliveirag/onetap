import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { useAnswers } from '@/components/onboarding/AnswersProvider';
import { Field } from '@/components/onboarding/Field';
import { FlowScreen } from '@/components/onboarding/FlowScreen';
import { Button } from '@/components/ui/Button';
import { progressOf } from '@/lib/onboarding';
import { nameError } from '@/lib/validate';
import { useTheme } from '@/theme/ThemeProvider';

// Venmo's "Tell us about you". First step of the account gate.
export default function Name() {
  const { theme } = useTheme();
  const { name, setName } = useAnswers();
  const [first, setFirst] = useState(name.first);
  const [last, setLast] = useState(name.last);
  const [errors, setErrors] = useState<{ first?: string | null; last?: string | null }>({});
  const lastRef = useRef<TextInput>(null);

  const next = () => {
    const e = { first: nameError(first, 'first'), last: nameError(last, 'last') };
    setErrors(e);
    if (e.first || e.last) return;
    setName({ first: first.trim(), last: last.trim() });
    router.push('/account');
  };

  return (
    <FlowScreen
      title="Tell us about you"
      subtitle="Create a free account to keep your plan. Start with your name."
      progress={progressOf('name')}
      footer={<Button label="Next" onPress={next} />}
    >
      <View style={{ gap: theme.space.lg }}>
        <Field
          label="First name"
          required
          value={first}
          onChangeText={setFirst}
          error={errors.first}
          autoComplete="given-name"
          textContentType="givenName"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => lastRef.current?.focus()}
          autoFocus
        />
        <Field
          ref={lastRef}
          label="Last name"
          required
          value={last}
          onChangeText={setLast}
          error={errors.last}
          autoComplete="family-name"
          textContentType="familyName"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={next}
        />
      </View>
    </FlowScreen>
  );
}
