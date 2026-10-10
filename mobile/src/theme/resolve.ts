import type { TextStyle } from 'react-native';

type Json = Record<string, any>;
export type Scheme = 'dark' | 'light';
export type TypeName = 'display' | 'h1' | 'h2' | 'h3' | 'h4' | 'body-lg' | 'body' | 'body-sm' | 'code' | 'caption';
export type Theme = {
  color: {
    text: Record<string, string>;
    icon: Record<string, string>;
    surface: Record<string, string>;
    border: Record<string, string>;
    effect: Record<string, string>;
  };
  type: Record<TypeName, TextStyle>;
  space: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl', number>;
  radius: Record<'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full', number>;
  pageMargin: number;
  controlHeight: { sm: number; md: number; lg: number };
  hitTarget: number;
};

// Family names registered with expo-font in the root layout (JetBrains Mono NL: no ligatures).
const FAMILY: Record<number, string> = { 400: 'JBMono-Regular', 500: 'JBMono-Medium', 700: 'JBMono-Bold' };

function get(root: Json, path: string): any {
  return path.split('.').reduce((node, key) => node?.[key], root);
}

function pick(token: Json, mode?: string): any {
  const modes = token?.$extensions?.modes;
  return mode && modes && mode in modes ? modes[mode] : token?.$value;
}

// Follows "{a.b.c}" references until it reaches a raw value, applying the mode at every hop.
function deref(root: Json, value: any, mode?: string): any {
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const token = get(root, value.slice(1, -1));
    return deref(root, pick(token, mode), mode);
  }
  return value;
}

const px = (v: string | number) => (typeof v === 'number' ? v : parseFloat(v));

export function resolveTheme(tokens: Json, scheme: Scheme): Theme {
  const color = {} as Theme['color'];
  for (const group of ['text', 'icon', 'surface', 'border', 'effect'] as const) {
    color[group] = {};
    for (const [name, token] of Object.entries<Json>(tokens.mapped[group])) {
      if (name.startsWith('$') || token.$type !== 'color') continue;
      color[group][name] = deref(tokens, pick(token, scheme), scheme);
    }
  }

  const r = tokens.responsive;
  const mobile = (token: Json) => px(deref(tokens, pick(token, 'mobile'), 'mobile'));

  const type = {} as Theme['type'];
  for (const [name, t] of Object.entries<Json>(r.type)) {
    const size = mobile(t['font-size']);
    const weight = Number(deref(tokens, t['font-weight'].$value));
    const em = parseFloat(t['letter-spacing'].$value);
    type[name as TypeName] = {
      fontFamily: FAMILY[weight],
      fontSize: size,
      lineHeight: mobile(t['line-height']),
      letterSpacing: em * size,
    };
  }

  const space = Object.fromEntries(
    Object.entries<Json>(r.space)
      .filter(([k]) => !k.startsWith('$'))
      .map(([k, t]) => [k, mobile(t)]),
  ) as Theme['space'];
  const radius = Object.fromEntries(
    Object.entries<Json>(tokens.alias.radius).map(([k, t]) => [k, px(deref(tokens, t.$value))]),
  ) as Theme['radius'];

  return {
    color,
    type,
    space,
    radius,
    pageMargin: mobile(r['page-margin']),
    controlHeight: {
      sm: mobile(r['control-height'].sm),
      md: mobile(r['control-height'].md),
      lg: mobile(r['control-height'].lg),
    },
    hitTarget: mobile(r['hit-target-min']),
  };
}
