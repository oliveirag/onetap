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
  });

  it('sets every weight in Geist and tightens bold headings only', () => {
    const t = resolveTheme(tokens, 'dark');
    expect(t.type.display.fontFamily).toBe('Geist-Bold');
    expect(t.type.caption.fontFamily).toBe('Geist-Medium');
    expect(t.type.body.fontFamily).toBe('Geist-Regular');
    expect(t.font.medium).toBe('Geist-Medium');
    expect(t.type.display.letterSpacing).toBeCloseTo(-1.6); // -0.02em token, -0.02em for Geist, at 40px
    expect(t.type.body.letterSpacing).toBe(0);
  });

  it('keeps raw rgba effect values', () => {
    expect(resolveTheme(tokens, 'dark').color.effect.scrim).toBe('#00000099');
  });
});
