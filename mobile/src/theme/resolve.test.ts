import tokens from './tokens.json';
import { resolveTheme } from './resolve';

describe('resolveTheme', () => {
  it('resolves dark mapped colors through alias to brand hex', () => {
    const t = resolveTheme(tokens, 'dark');
    expect(t.color.surface.page).toBe('#171717');
    expect(t.color.text.primary).toBe('#FAFAFA');
    expect(t.color.surface.action).toBe('#FFFFFF');
  });

  it('switches mapped colors in light mode', () => {
    const t = resolveTheme(tokens, 'light');
    expect(t.color.surface.page).toBe('#FFFFFF');
    expect(t.color.text.primary).toBe('#171717');
  });

  it('uses mobile responsive values as numbers', () => {
    const t = resolveTheme(tokens, 'dark');
    expect(t.space.xl).toBe(20);
    expect(t.pageMargin).toBe(16);
    expect(t.controlHeight.md).toBe(44);
    expect(t.type.display.fontSize).toBe(40);
    expect(t.type.display.lineHeight).toBe(48);
    expect(t.type.display.letterSpacing).toBeCloseTo(-0.8);
    expect(t.type.display.fontFamily).toBe('JBMono-Bold');
    expect(t.type.caption.fontFamily).toBe('JBMono-Medium');
  });

  it('keeps raw rgba effect values', () => {
    expect(resolveTheme(tokens, 'dark').color.effect.scrim).toBe('#00000099');
  });
});
