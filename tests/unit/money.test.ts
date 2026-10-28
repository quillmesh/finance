import { describe, expect, test } from 'bun:test';
import { fmt, parseRappen, pct, plain } from '../../src/money';

describe('TST-01: Beträge als ganze Rappen', () => {
  test.each([
    ['12', 1200], ['12.5', 1250], ['12.50', 1250], ['1.2', 120], ['-4.6', -460], ["1'500.00", 150000], ['1’500.00', 150000],
    ['105.800', 10580], ['0.005', 1], ['0.004', 0], ['12,50', 1250], ['1,500.00', 150000], ['.5', 50], [' 7 ', 700], [7.1, 710], ['-0', 0],
  ] as [string | number, number][])('%p → %p Rappen', (input, want) => {
    expect(parseRappen(input)).toBe(want);
  });

  test.each(['', 'abc', '1.2.3', '--1', null, undefined])('ungültig: %p → NaN', (input) => {
    expect(parseRappen(input as string)).toBeNaN();
  });

  test('keine Rundungsfehler beim Summieren (0.1 + 0.2)', () => {
    expect(parseRappen('0.1') + parseRappen('0.2')).toBe(30);
    const many = Array.from({ length: 1000 }, () => parseRappen('0.10')).reduce((a, b) => a + b, 0);
    expect(many).toBe(10000);
  });

  test('Anzeige mit Schweizer Tausendertrenner', () => {
    expect(fmt(150000)).toBe('1’500.00');
    expect(fmt(5)).toBe('0.05');
    expect(fmt(-123456789)).toBe('-1’234’567.89');
    expect(plain(150000)).toBe('1500.00');
    expect(plain(-5)).toBe('-0.05');
  });

  test('Prozent', () => {
    expect(pct(1, 3)).toBe('33.3');
    expect(pct(0, 0)).toBe('0.0');
    expect(pct(2, 2)).toBe('100.0');
  });
});
