import {
  isOwnEntityMention,
  ownEntityNames,
  packageRootOf,
  withoutOwnEntityMentions,
} from '../../src/common/ownEntityMention';

const nextJs = ownEntityNames({
  canonicalName: 'Next.js',
  aliases: ['nextjs'],
  codeOnlyAliases: ['next'],
});

describe('packageRootOf', () => {
  it('should read a subpath as a path inside its package, scoped or not', () => {
    expect(packageRootOf('next/image')).toEqual('next');
    expect(packageRootOf('@scope/pkg/sub')).toEqual('@scope/pkg');
  });

  it('should leave a package that is not a subpath alone', () => {
    expect(packageRootOf('next')).toEqual('next');
    expect(packageRootOf('@scope/pkg')).toEqual('@scope/pkg');
  });
});

describe('isOwnEntityMention', () => {
  it('should refuse the claim entity name in any of the three name columns', () => {
    // canonical, alias, code-only alias — `codeOnlyCanonical` and
    // `codeOnlyAliases` gate entity RESOLUTION, and this rule is not asking
    // what the token resolved.
    for (const token of ['Next.js', 'nextjs', 'next']) {
      expect({ token, own: isOwnEntityMention(token, nextJs) }).toEqual({
        token,
        own: true,
      });
    }
  });

  it('should refuse a module path inside a package of that name', () => {
    // `{images.domains, next/image}` is the shape gap 24 named: six reps
    // imported `next/image`, configured no images, and read a tier-A finding.
    for (const token of ['next/image', 'next/link', 'next/legacy/image']) {
      expect({ token, own: isOwnEntityMention(token, nextJs) }).toEqual({
        token,
        own: true,
      });
    }
  });

  it('should refuse a scoped module path against a scoped package name', () => {
    const ionic = ownEntityNames({
      canonicalName: 'Ionic Framework',
      aliases: ['@ionic/angular'],
      codeOnlyAliases: [],
    });

    expect(isOwnEntityMention('@ionic/angular/standalone', ionic)).toBe(true);
    expect(isOwnEntityMention('@ionic/react', ionic)).toBe(false);
  });

  it('should keep a symbol of the product, which is what a signature is for', () => {
    for (const token of ['images.domains', 'legacyBehavior', 'middleware']) {
      expect({ token, own: isOwnEntityMention(token, nextJs) }).toEqual({
        token,
        own: false,
      });
    }
  });

  it('should keep a path under a host, which names an endpoint rather than a module', () => {
    // The narrowing rot-bench asks the Public Suffix List for: an entity
    // aliased to a hostname keeps its signature on a path under it, because
    // the operator chose that path to name ONE endpoint.
    const vendor = ownEntityNames({
      canonicalName: 'Vendor AI',
      aliases: ['generativelanguage.vendorai.com'],
      codeOnlyAliases: [],
    });

    expect(
      isOwnEntityMention('generativelanguage.vendorai.com/api/v1', vendor),
    ).toBe(false);
  });

  it('should not let a one- or two-character alias eat an unrelated token', () => {
    const tiny = ownEntityNames({
      canonicalName: 'Go',
      aliases: ['go'],
      codeOnlyAliases: [],
    });

    expect(isOwnEntityMention('go', tiny)).toBe(false);
  });
});

describe('withoutOwnEntityMentions', () => {
  it('should strip the mention when the array names something more specific', () => {
    expect(
      withoutOwnEntityMentions({
        tokens: ['images.domains', 'next/image'],
        names: nextJs,
      }),
    ).toEqual(['images.domains']);
  });

  it('should empty an all-mention array for an extractor, which cannot make the subject-level call', () => {
    expect(
      withoutOwnEntityMentions({ tokens: ['next/image'], names: nextJs }),
    ).toEqual([]);
  });

  it('should keep an all-mention array for a reviewer, whose claim may be about the module itself', () => {
    // `0ded4c9b` — "a local `src` containing a query string needs
    // `images.localPatterns`" — carries `{next/image}` because its subject is
    // a usage pattern no token captures. Emptying it deletes the only thing
    // the claim says.
    expect(
      withoutOwnEntityMentions({
        tokens: ['next/image'],
        names: nextJs,
        keepWhenNoSurvivor: true,
      }),
    ).toEqual(['next/image']);
    expect(
      withoutOwnEntityMentions({
        tokens: ['next/image', 'next/link'],
        names: nextJs,
        keepWhenNoSurvivor: true,
      }),
    ).toEqual(['next/image', 'next/link']);
  });

  it('should leave an array with no mention in it untouched', () => {
    expect(
      withoutOwnEntityMentions({
        tokens: ['images.domains', 'images.remotePatterns'],
        names: nextJs,
        keepWhenNoSurvivor: true,
      }),
    ).toEqual(['images.domains', 'images.remotePatterns']);
  });
});
