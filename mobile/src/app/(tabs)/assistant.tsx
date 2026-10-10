import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Composer, MessageList, TypingDots, type ChatMessage } from '@/components/reclaimed/ChatThread';
import { Button } from '@/components/ui/Button';
import { DemoLabel } from '@/components/ui/DemoLabel';
import { Segmented } from '@/components/ui/Segmented';
import { ErrorState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';

type Mode = 'points' | 'relay';
type Thread = { messages: ChatMessage[]; threadId?: string; waiting: boolean; failed: string | null };

const MODES: { value: Mode; label: string }[] = [
  { value: 'points', label: 'Points planner' },
  { value: 'relay', label: 'Spending' },
];

const SUGGESTIONS: Record<Mode, string[]> = {
  points: ['Fly to Canada', 'A weekend in New York', 'What can my points get me'],
  relay: ['Where did my money go this month', 'Which card earned the most', 'How much extra did I earn'],
};

const empty = (): Thread => ({ messages: [], waiting: false, failed: null });
let nextId = 0;
const id = () => `msg-${Date.now()}-${nextId++}`;

// PRD Assistant: Points planner and Spending (Relay), one thread each. Numbers arrive verbatim
// from the backend; this screen never computes or rewrites them.
export default function Assistant() {
  const { theme, reduceMotion } = useTheme();
  const [mode, setMode] = useState<Mode>('points');
  const [threads, setThreads] = useState<Record<Mode, Thread>>({ points: empty(), relay: empty() });
  const [animateId, setAnimateId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const thread = threads[mode];

  const patch = (m: Mode, fn: (t: Thread) => Thread) => setThreads((all) => ({ ...all, [m]: fn(all[m]) }));

  // `retry` re-sends the failed text without adding the user's message a second time.
  const ask = async (text: string, retry = false) => {
    const m = mode;
    const userMsg: ChatMessage = { id: id(), role: 'user', text };
    patch(m, (t) => ({ ...t, waiting: true, failed: null, messages: retry ? t.messages : [...t.messages, userMsg] }));
    if (!retry) setAnimateId(userMsg.id);
    try {
      const res = await api.chat({ mode: m, message: text, threadId: threads[m].threadId });
      const reply: ChatMessage = { id: id(), role: 'assistant', text: res.reply };
      patch(m, (t) => ({ ...t, waiting: false, threadId: res.threadId, messages: [...t.messages, reply] }));
      setAnimateId(reply.id);
    } catch {
      patch(m, (t) => ({ ...t, waiting: false, failed: text }));
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.color.surface.page }}>
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: !reduceMotion })}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: theme.pageMargin, paddingBottom: theme.space.xl, gap: theme.space.lg }}
      >
        <Text variant="h2" accessibilityRole="header">
          Assistant
        </Text>
        <View style={{ gap: theme.space.sm }}>
          <Segmented label="Assistant mode" options={MODES} value={mode} onChange={setMode} />
          <DemoLabel text="Point values and award prices are estimates" />
        </View>

        {thread.messages.length === 0 && !thread.waiting ? (
          <View style={{ gap: theme.space.sm, alignItems: 'flex-start' }}>
            <Text variant="body-sm" tone="secondary">
              {mode === 'points' ? 'Plan a trip with the points you already have.' : 'Ask about where your money went this month.'}
            </Text>
            {SUGGESTIONS[mode].map((s) => (
              <Button key={s} variant="secondary" label={s} onPress={() => ask(s)} />
            ))}
          </View>
        ) : (
          <View>
            <MessageList messages={thread.messages} animateId={animateId} />
            {thread.waiting ? <TypingDots /> : null}
            {thread.failed ? (
              <ErrorState what="The assistant did not respond." todo="Try again in a moment." onRetry={() => ask(thread.failed!, true)} />
            ) : null}
          </View>
        )}
      </ScrollView>
      <Composer
        onSend={(text) => {
          if (thread.waiting) return false;
          ask(text);
          return true;
        }}
        placeholder={mode === 'points' ? 'Where do you want to go?' : 'Ask about your spending'} />
    </KeyboardAvoidingView>
  );
}
