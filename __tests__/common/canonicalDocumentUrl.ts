import { canonicalDocumentUrl } from '../../src/common/claimLedger';

describe('canonicalDocumentUrl', () => {
  it('should collapse the spellings a feed produces for one document', () => {
    expect(
      [
        'http://www.anthropic.com/changelog/',
        'https://anthropic.com/changelog?utm_source=rss&utm_medium=feed',
        'https://www.anthropic.com/changelog#2026-08-01',
        '  https://anthropic.com/changelog  ',
      ].map(canonicalDocumentUrl),
    ).toEqual(Array(4).fill('https://anthropic.com/changelog'));
  });

  it('should keep what really addresses another document', () => {
    expect(
      [
        'https://vendor.dev/Changelog',
        'https://vendor.dev/changelog?page=2&utm_source=rss',
        'not a url',
      ].map(canonicalDocumentUrl),
    ).toEqual([
      'https://vendor.dev/Changelog',
      'https://vendor.dev/changelog?page=2',
      'not a url',
    ]);
  });

  it('should order query params so one request has one spelling', () => {
    expect(canonicalDocumentUrl('https://vendor.dev/notes?b=2&a=1')).toEqual(
      canonicalDocumentUrl('https://vendor.dev/notes?a=1&b=2'),
    );
  });

  it('should leave a bare origin addressable', () => {
    expect(canonicalDocumentUrl('https://vendor.dev')).toEqual(
      'https://vendor.dev/',
    );
  });
});
