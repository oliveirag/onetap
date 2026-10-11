import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Enter } from '@/components/ui/Enter';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Text } from '@/components/ui/Text';
import { duration } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

// A selectable card row (Venmo's "How will you Venmo?" and privacy rows): leading icon or art,
// label and description, trailing radio (single) or checkbox (multi). The whole row is the target.
export function Choice({
  label,
  description,
  icon,
  leading,
  selected,
  multi = false,
  onPress,
}: {
  label: string;
  description?: string;
  icon?: IconName;
  leading?: ReactNode;
  selected: boolean;
  multi?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <PressableScale
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={description ? `${label}, ${description}` : label}
      onPress={onPress}
      hitSlop={0}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.md,
        minHeight: theme.hitTarget + theme.space.lg,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: selected ? c.border.focus : c.border.default,
        backgroundColor: selected ? c.surface.selected : c.surface.default,
      }}
    >
      {leading ??
        (icon ? (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.full,
              backgroundColor: c.surface.raised,
              borderWidth: 1,
              borderColor: c.border.default,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={icon} size={18} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: theme.space.xs }}>
        <Text style={{ fontFamily: theme.font.medium }}>{label}</Text>
        {description ? (
          <Text variant="body-sm" tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      {multi ? <CheckBox checked={selected} /> : <Radio selected={selected} />}
    </PressableScale>
  );
}

export function Radio({ selected }: { selected: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: selected ? theme.color.border.action : theme.color.border.control,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* DS Radio: the dot enters from scale 0.95, never from 0. */}
      {selected ? (
        <Enter ms={duration.fast} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.color.surface.action }} />
      ) : null}
    </View>
  );
}

export function CheckBox({ checked }: { checked: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: theme.radius.sm,
        borderWidth: 1.5,
        borderColor: checked ? theme.color.border.action : theme.color.border.control,
        backgroundColor: checked ? theme.color.surface.action : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* DS Checkbox: pointer toggles crossfade 150ms. */}
      {checked ? (
        <Enter kind="fade" ms={duration.fast}>
          <Icon name="check" size={14} tone="on-action" />
        </Enter>
      ) : null}
    </View>
  );
}
