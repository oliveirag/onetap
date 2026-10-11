import { describe, expect, it } from 'vitest';
import { descriptorSuffix, fullDescriptor, MAX_SUFFIX_LENGTH } from '../src/stripe-descriptor.js';

describe('statement descriptor', () => {
  it('uppercases the merchant name', () => {
    expect(descriptorSuffix('Knight Bites')).toBe('KNIGHT BITES');
    expect(fullDescriptor('Knight Bites')).toBe('ONETAP* KNIGHT BITES');
  });

  it('a 14-character name reaches exactly 22 characters', () => {
    expect(MAX_SUFFIX_LENGTH).toBe(14);
    expect(fullDescriptor('Pegasus Market')).toBe('ONETAP* PEGASUS MARKET');
    expect(fullDescriptor('Pegasus Market')).toHaveLength(22);
  });

  it('every seeded merchant fits untruncated', () => {
    for (const name of ['Knight Bites', 'Citrus Coffee', 'Pegasus Market', 'Sunshine Fuel', 'StreamBox', 'Orlando Air', 'Lakeside Inn', 'Campus Books']) {
      expect(descriptorSuffix(name)).toBe(name.toUpperCase());
    }
  });

  it('strips characters Stripe rejects', () => {
    expect(descriptorSuffix(`Joe's "Best" <Deli>*`)).toBe('JOES BEST DELI');
    expect(descriptorSuffix('A\\B')).toBe('AB');
  });

  it('truncates long names and trims the trailing space', () => {
    expect(descriptorSuffix('Lakeside Inn and Suites')).toBe('LAKESIDE INN A');
    expect(descriptorSuffix('Orlando Airport X')).toBe('ORLANDO AIRPOR');
    expect(descriptorSuffix('Campus Books Store')).toBe('CAMPUS BOOKS S');
    expect(descriptorSuffix('Sunshine Fuel  Co')).toBe('SUNSHINE FUEL');
  });

  it('drops accents and non-ASCII', () => {
    expect(descriptorSuffix('Café Olé ☕')).toBe('CAFE OLE');
  });

  it('falls back when no letter survives', () => {
    expect(descriptorSuffix('7-11 **')).toBe('PURCHASE');
    expect(descriptorSuffix('')).toBe('PURCHASE');
  });
});
