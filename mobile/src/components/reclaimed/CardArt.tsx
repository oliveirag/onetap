import Svg, { Circle, Defs, Line, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

// Achromatic textures stand in for issuer colors: one pattern per card_products.card_art key.
export function CardArt({ art, size = 'sm' }: { art: string; size?: 'sm' | 'md' }) {
  const { theme } = useTheme();
  const [w, h] = size === 'sm' ? [40, 26] : [64, 40];
  const ink = theme.color.border.strong;
  const fill = theme.color.surface.raised;
  const id = `art-${art}`;

  return (
    <Svg width={w} height={h} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <Pattern id="art-lines" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Line x1={0} y1={0} x2={0} y2={6} stroke={ink} strokeWidth={1.5} />
        </Pattern>
        <Pattern id="art-dots" width={5} height={5} patternUnits="userSpaceOnUse">
          <Circle cx={2.5} cy={2.5} r={1} fill={ink} />
        </Pattern>
        <Pattern id="art-grid" width={6} height={6} patternUnits="userSpaceOnUse">
          <Line x1={0} y1={0} x2={6} y2={0} stroke={ink} strokeWidth={1} />
          <Line x1={0} y1={0} x2={0} y2={6} stroke={ink} strokeWidth={1} />
        </Pattern>
      </Defs>
      <Rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={theme.radius.sm} fill={fill} stroke={theme.color.border.strong} />
      {art === 'solid' ? null : <Rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={theme.radius.sm} fill={`url(#${id})`} />}
    </Svg>
  );
}
