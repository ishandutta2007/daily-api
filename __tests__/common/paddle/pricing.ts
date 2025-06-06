import type { Interval } from '@paddle/paddle-node-sdk';
import { getPrice, getProductPrice } from '../../../src/common/paddle/pricing';

describe('getPrice', () => {
  it('should parse USD currency format', () => {
    const result = getPrice({ formatted: '$5.00' });
    expect(result).toEqual({
      amount: 5,
      formatted: '$5.00',
    });
  });

  it('should parse EUR currency format', () => {
    const result = getPrice({ formatted: '€5.00' });
    expect(result).toEqual({
      amount: 5,
      formatted: '€5.00',
    });
  });

  it('should parse GBP currency format', () => {
    const result = getPrice({ formatted: '£5.00' });
    expect(result).toEqual({
      amount: 5,
      formatted: '£5.00',
    });
  });

  it('should parse JPY currency format (no decimals)', () => {
    const result = getPrice({ formatted: '¥500' });
    expect(result).toEqual({
      amount: 500,
      formatted: '¥500',
    });
  });

  it('should parse currency with thousands separator', () => {
    const result = getPrice({ formatted: '$1,234.56' });
    expect(result).toEqual({
      amount: 1234.56,
      formatted: '$1,234.56',
    });
  });

  it('should parse currency with different locale', () => {
    const result = getPrice({ formatted: '1.234,56 €', locale: 'de-DE' });
    expect(result).toEqual({
      amount: 1234.56,
      formatted: '1.234,56 €',
    });
  });

  it('should handle divided amount', () => {
    const result = getPrice({ formatted: '$60.00', divideBy: 12 });
    expect(result).toEqual({
      amount: 5,
      formatted: '$5.00',
    });
  });

  it('should handle divided amount with different locale', () => {
    const result = getPrice({
      formatted: '60,00 €',
      locale: 'fr-FR',
      divideBy: 12,
    });
    expect(result).toEqual({
      amount: 5,
      formatted: '5,00 €',
    });
  });

  it('should throw error for invalid currency format', () => {
    expect(() => getPrice({ formatted: 'invalid' })).toThrow(
      'Invalid currency format',
    );
  });

  it('should handle zero amount', () => {
    const result = getPrice({ formatted: '$0.00' });
    expect(result).toEqual({
      amount: 0,
      formatted: '$0.00',
    });
  });

  it('should handle currency with space between symbol and amount', () => {
    const result = getPrice({ formatted: '€ 5.00' });
    expect(result).toEqual({
      amount: 5,
      formatted: '€ 5.00',
    });
  });

  it('should handle currency with space after amount', () => {
    const result = getPrice({ formatted: '5.00 €' });
    expect(result).toEqual({
      amount: 5,
      formatted: '5.00 €',
    });
  });

  it('should handle currency with no space between symbol and amount', () => {
    const result = getPrice({ formatted: '€5.00' });
    expect(result).toEqual({
      amount: 5,
      formatted: '€5.00',
    });
  });

  it('should handle Indian Rupee format', () => {
    const result = getPrice({ formatted: '₹49.97', locale: 'en-IN' });
    expect(result).toEqual({
      amount: 49.97,
      formatted: '₹49.97',
    });
  });

  it('should handle Swedish Krona format with symbol after amount', () => {
    const result = getPrice({
      formatted: '1499,00 kr',
      locale: 'sv-SE',
      divideBy: 30, // Convert monthly to daily price
    });
    expect(result).toEqual({
      amount: 49.96,
      formatted: '49,96 kr',
    });
  });

  it('should handle Brazilian Real format with specific spacing', () => {
    const result = getPrice({ formatted: 'R$ 149,90', locale: 'pt-BR' });
    expect(result).toEqual({
      amount: 149.9,
      formatted: 'R$ 149,90',
    });
  });

  it('should handle yearly to monthly price conversion with precise rounding', () => {
    const result = getPrice({ formatted: '$89.99', divideBy: 12 });
    expect(result).toEqual({
      amount: 7.49, // Should be 7.49 not 7.50 to preserve original price precision
      formatted: '$7.49',
    });
  });

  // we have not covered the case where there are multiple spaces within the format and negative values
});

describe('getProductPrice', () => {
  const mockPricingPreviewLineItem = (interval?: Interval, locale?: string) => {
    return {
      interval,
      total: locale === 'fr-FR' ? '€60,00' : '$60.00',
    };
  };

  it('should return base price when no interval is provided', () => {
    const result = getProductPrice(mockPricingPreviewLineItem());
    expect(result.amount).toBe(60);
    expect(result.formatted).toBe('$60.00');
  });

  it('should calculate monthly and daily prices for monthly interval', () => {
    const result = getProductPrice(mockPricingPreviewLineItem('month'));
    expect(result.amount).toBe(60);
    expect(result.formatted).toBe('$60.00');
    expect(result.monthly).toEqual({
      amount: 60,
      formatted: '$60.00',
    });
    expect(result.daily).toEqual({
      amount: 2,
      formatted: '$2.00',
    });
  });

  it('should calculate monthly and daily prices for yearly interval', () => {
    const result = getProductPrice(mockPricingPreviewLineItem('year'));
    expect(result.amount).toBe(60);
    expect(result.formatted).toBe('$60.00');
    expect(result.monthly).toEqual({
      amount: 5,
      formatted: '$5.00',
    });
    expect(result.daily).toEqual({
      amount: 0.16,
      formatted: '$0.16',
    });
  });

  it('should handle different locale for monthly interval', () => {
    const result = getProductPrice(
      mockPricingPreviewLineItem('month', 'fr-FR'),
      'fr-FR',
    );
    expect(result.amount).toBe(60);
    expect(result.formatted).toBe('€60,00');
    expect(result.monthly).toEqual({
      amount: 60,
      formatted: '€60,00',
    });
    expect(result.daily).toEqual({
      amount: 2,
      formatted: '€2,00',
    });
  });

  it('should handle different locale for yearly interval', () => {
    const result = getProductPrice(
      mockPricingPreviewLineItem('year', 'fr-FR'),
      'fr-FR',
    );
    expect(result.amount).toBe(60);
    expect(result.formatted).toBe('€60,00');
    expect(result.monthly).toEqual({
      amount: 5,
      formatted: '€5,00',
    });
    expect(result.daily).toEqual({
      amount: 0.16,
      formatted: '€0,16',
    });
  });

  it('should handle zero amount for monthly interval', () => {
    const item = { ...mockPricingPreviewLineItem('month'), total: '$0.00' };
    const result = getProductPrice(item);
    expect(result.amount).toBe(0);
    expect(result.formatted).toBe('$0.00');
    expect(result.monthly).toEqual({
      amount: 0,
      formatted: '$0.00',
    });
    expect(result.daily).toEqual({
      amount: 0,
      formatted: '$0.00',
    });
  });

  it('should handle zero amount for yearly interval', () => {
    const item = { ...mockPricingPreviewLineItem('year'), total: '$0.00' };
    const result = getProductPrice(item);
    expect(result.amount).toBe(0);
    expect(result.formatted).toBe('$0.00');
    expect(result.monthly).toEqual({
      amount: 0,
      formatted: '$0.00',
    });
    expect(result.daily).toEqual({
      amount: 0,
      formatted: '$0.00',
    });
  });
});
