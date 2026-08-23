import { corroborationVerdict } from '../../src/common/claimCorroboration';
import {
  distinctPublishers,
  evidencePublisher,
} from '../../src/common/evidencePublisher';
import { ClaimEvidenceSourceClass } from '../../src/entity/claim/ClaimEvidence';

const community = (url: string) => ({
  url,
  sourceClass: ClaimEvidenceSourceClass.Community,
});
const vendor = (url: string) => ({
  url,
  sourceClass: ClaimEvidenceSourceClass.VendorChangelog,
});
const registry = (url: string) => ({
  url,
  sourceClass: ClaimEvidenceSourceClass.Registry,
});

describe('evidencePublisher', () => {
  it('should identify a publisher by registrable domain, not hostname', () => {
    // The measured case: `elixirforum.com` and `forum.elixirforum.com` are one
    // forum, and a hostname unit would have counted them as two sources.
    expect(evidencePublisher('https://forum.elixirforum.com/t/1')).toEqual(
      'elixirforum.com',
    );
    expect(evidencePublisher('https://elixirforum.com/t/1')).toEqual(
      'elixirforum.com',
    );
  });

  it('should use the public suffix list rather than the last two labels', () => {
    expect(evidencePublisher('https://www.bbc.co.uk/news/1')).toEqual(
      'bbc.co.uk',
    );
    expect(evidencePublisher('https://omgubuntu.co.uk/post')).toEqual(
      'omgubuntu.co.uk',
    );
  });

  it('should refuse daily.dev permalinks as a publisher at all', () => {
    // Our own platform: these are `collections`/`trends` roundups derived from
    // the very posts they cite, so counting them is the ledger citing itself.
    expect(
      evidencePublisher('https://app.daily.dev/posts/8Gcz1p1Kb'),
    ).toBeNull();
    expect(
      evidencePublisher('https://daily.dev/posts/ghost-6-expands'),
    ).toBeNull();
  });

  it('should refuse the dly.to shortener, which redirects into daily.dev', () => {
    expect(evidencePublisher('https://dly.to/UJZwtiRtu77')).toBeNull();
  });

  it('should refuse a scraper that republishes under the same slug', () => {
    expect(
      evidencePublisher('https://readarticle.at/when-coding-agents-forget'),
    ).toBeNull();
  });

  it('should fold the This Week in Rails newsletter onto rubyonrails.org', () => {
    // One newsletter at two addresses — the largest false-promotion class left
    // after the daily.dev exclusion, at 113 claims.
    expect(
      evidencePublisher('https://world.hey.com/this.week.in.rails/redirect-x'),
    ).toEqual('rubyonrails.org');
  });

  it('should keep hey.com/dhh as its own publisher', () => {
    // The reason that alias is path-qualified: 4 hey.com rows are a genuinely
    // separate blog, and a domain-level rule would have folded them away too.
    expect(evidencePublisher('https://world.hey.com/dhh/some-post')).toEqual(
      'hey.com',
    );
  });

  it('should treat x.com and twitter.com as one publisher', () => {
    expect(evidencePublisher('https://twitter.com/foo/status/1')).toEqual(
      'x.com',
    );
    expect(evidencePublisher('https://x.com/foo/status/1')).toEqual('x.com');
  });

  it('should return null for a url it cannot parse', () => {
    expect(evidencePublisher('not a url')).toBeNull();
    expect(evidencePublisher('')).toBeNull();
  });

  it('should not let two unnameable rows look like two publishers', () => {
    expect(distinctPublishers(['not a url', 'also not a url'])).toEqual([]);
  });
});

describe('corroborationVerdict', () => {
  it('should corroborate a claim two independent publishers assert', () => {
    expect(
      corroborationVerdict([
        community('https://techcrunch.com/2025/08/05/ghost'),
        community('https://blog.cloudflare.com/local-tracing'),
      ]),
    ).toMatchObject({
      corroborated: true,
      reason: 'distinct_publishers',
      publishers: ['cloudflare.com', 'techcrunch.com'],
    });
  });

  it('should NOT corroborate one publisher posting twice', () => {
    // The settled reading of playbook §2: "independent" beats "distinct posts".
    // This is the Babel shape from product-wiki §6h — two babeljs.io release
    // posts are two posts but one source.
    expect(
      corroborationVerdict([
        community('https://babeljs.io/blog/2026/01/01/7.29.0'),
        community('https://babeljs.io/blog/2026/02/02/8.0.0'),
      ]),
    ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
  });

  it('should NOT corroborate a subdomain of the same publisher', () => {
    expect(
      corroborationVerdict([
        community('https://elixirforum.com/t/release/1'),
        community('https://forum.elixirforum.com/t/release/1'),
      ]),
    ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
  });

  it('should NOT corroborate a real article plus our own daily.dev mirror', () => {
    // 461 candidate claims in prod reached two "publishers" only this way.
    expect(
      corroborationVerdict([
        community('https://blog.cloudflare.com/local-tracing'),
        community('https://app.daily.dev/posts/8Gcz1p1Kb'),
      ]),
    ).toMatchObject({
      corroborated: false,
      reason: 'single_publisher',
      publishers: ['cloudflare.com'],
    });
  });

  it('should NOT corroborate the Rails newsletter beside rubyonrails.org', () => {
    expect(
      corroborationVerdict([
        community('https://rubyonrails.org/2025/9/26/this-week-in-rails'),
        community('https://world.hey.com/this.week.in.rails/redirect-source'),
      ]),
    ).toMatchObject({
      corroborated: false,
      reason: 'single_publisher',
      publishers: ['rubyonrails.org'],
    });
  });

  it('should NOT corroborate a dev.to post beside its scraped mirror', () => {
    expect(
      corroborationVerdict([
        community('https://dev.to/rawveg/when-coding-agents-forget-44g0'),
        community('https://readarticle.at/when-coding-agents-forget'),
      ]),
    ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
  });

  it('should collapse an RT mirror onto its source tweet (playbook R21)', () => {
    expect(
      corroborationVerdict([
        community('https://twitter.com/vercel/status/1'),
        community('https://x.com/someoneelse/status/2'),
      ]),
    ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
  });

  it('should report no independent evidence when nothing names a publisher', () => {
    expect(
      corroborationVerdict([community('https://app.daily.dev/posts/A')]),
    ).toMatchObject({
      corroborated: false,
      reason: 'no_independent_evidence',
      publishers: [],
    });
  });

  it('should ignore sourceClass by default, so a relabel cannot promote', () => {
    // Law 3: "sourceClass upgrades never promote". Same two urls, one relabelled
    // vendor_changelog — the verdict must not move.
    const urls = [
      'https://babeljs.io/blog/a',
      'https://babeljs.io/blog/b',
    ] as const;

    expect(
      corroborationVerdict([community(urls[0]), community(urls[1])]),
    ).toMatchObject({ corroborated: false });
    expect(
      corroborationVerdict([vendor(urls[0]), community(urls[1])]),
    ).toMatchObject({ corroborated: false });
  });

  describe('provenance rows', () => {
    it('should NOT corroborate a single source plus the R15a registry read', () => {
      // The escalated shape: one Medium post by the package author, plus the
      // packagist.org page R15a requires be recorded when the ship date is read
      // off it. Two domains, one opinion — packagist knows v4.1.0 exists, not
      // that syncPermissions() became variadic.
      expect(
        corroborationVerdict([
          community('https://medium.com/@sebarca0/migrating-from-spatie'),
          registry(
            'https://packagist.org/packages/scabarcas/laravel-permissions-redis',
          ),
        ]),
      ).toMatchObject({
        corroborated: false,
        reason: 'single_publisher',
        publishers: ['medium.com'],
      });
    });

    it('should NOT corroborate a GitHub release plus its hex.pm registry row', () => {
      expect(
        corroborationVerdict([
          vendor('https://github.com/fuelen/composite/releases/tag/v0.7.0'),
          registry('https://hex.pm/packages/composite/0.7.0'),
        ]),
      ).toMatchObject({
        corroborated: false,
        reason: 'single_publisher',
        publishers: ['github.com'],
      });
    });

    it('should report no independent evidence when only a registry row exists', () => {
      expect(
        corroborationVerdict([registry('https://hex.pm/packages/composite')]),
      ).toMatchObject({
        corroborated: false,
        reason: 'no_independent_evidence',
        publishers: [],
      });
    });

    it('should still corroborate two real publishers when a registry row rides along', () => {
      // The drop is surgical: it removes the provenance row, not the claim.
      expect(
        corroborationVerdict([
          community('https://techcrunch.com/2026/08/19/laravel'),
          community('https://medium.com/@sebarca0/migrating-from-spatie'),
          registry(
            'https://packagist.org/packages/scabarcas/laravel-permissions-redis',
          ),
        ]),
      ).toMatchObject({ corroborated: true, reason: 'distinct_publishers' });
    });

    it('should let a relabel to registry only ever demote, never promote', () => {
      // Law 3 restated for the one direction sourceClass is now read in.
      const rows = [
        'https://medium.com/@sebarca0/a',
        'https://packagist.org/packages/scabarcas/laravel-permissions-redis',
      ] as const;

      expect(
        corroborationVerdict([community(rows[0]), community(rows[1])]),
      ).toMatchObject({ corroborated: true });
      expect(
        corroborationVerdict([community(rows[0]), registry(rows[1])]),
      ).toMatchObject({ corroborated: false });
    });

    it('should still corroborate a news report plus its NVD entry', () => {
      // The drop is package registries only, and this is why: `registry` in prod
      // is mostly nvd.nist.gov and cvedetails.com, and an NVD page attests the
      // vulnerability, its severity and its affected range — the very fact the
      // claim states. That is not provenance.
      expect(
        corroborationVerdict([
          community('https://thehackernews.com/2026/08/cve'),
          registry('https://nvd.nist.gov/vuln/detail/CVE-2026-1234'),
        ]),
      ).toMatchObject({ corroborated: true, reason: 'distinct_publishers' });
    });

    it('should still corroborate a post plus a github release labelled registry', () => {
      // 2 prod rows carry `registry:github.com`. A release page is the vendor's
      // own notes; it attests behaviour, so github.com is not on the host list.
      expect(
        corroborationVerdict([
          community('https://phpunit.expert/post'),
          registry(
            'https://github.com/sebastianbergmann/phpunit/releases/tag/12.0.0',
          ),
        ]),
      ).toMatchObject({ corroborated: true, reason: 'distinct_publishers' });
    });

    it('should drop a package registry named by any of its hosts', () => {
      // Registrable domain, so the subdomain each registry actually serves from
      // resolves onto the same entry: registry.npmjs.org, repo.packagist.org.
      expect(
        corroborationVerdict([
          community('https://medium.com/@a/post'),
          registry('https://registry.npmjs.org/left-pad'),
        ]),
      ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
      expect(
        corroborationVerdict([
          community('https://medium.com/@a/post'),
          registry('https://pkg.go.dev/golang.org/x/tools'),
        ]),
      ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
    });

    it('should not drop a package registry row mislabelled community', () => {
      // Both halves are required. A registry url a reviewer typed as `community`
      // still counts — the fix is the label, not a host-only rule that would also
      // swallow a genuine article hosted on a registry domain.
      expect(
        corroborationVerdict([
          community('https://medium.com/@a/post'),
          community(
            'https://packagist.org/packages/scabarcas/laravel-permissions-redis',
          ),
        ]),
      ).toMatchObject({ corroborated: true, reason: 'distinct_publishers' });
    });

    it('should not let the opt-in branch resurrect a dropped registry row', () => {
      // `Registry` was removed from OFFICIAL_SOURCE_CLASSES for this reason: with
      // the old membership, enabling the branch would have promoted exactly the
      // pair the drop exists to stop.
      expect(
        corroborationVerdict(
          [
            community('https://medium.com/@sebarca0/a'),
            registry(
              'https://packagist.org/packages/scabarcas/laravel-permissions-redis',
            ),
          ],
          { allowVendorCrossClass: true },
        ),
      ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
    });
  });

  describe('vendor cross-class branch (opt-in)', () => {
    it('should corroborate vendor + community from one publisher when enabled', () => {
      expect(
        corroborationVerdict(
          [
            vendor('https://babeljs.io/blog/8.0.0'),
            community('https://babeljs.io/blog/breakage'),
          ],
          { allowVendorCrossClass: true },
        ),
      ).toMatchObject({ corroborated: true, reason: 'vendor_cross_class' });
    });

    it('should still require a second row of a different class', () => {
      expect(
        corroborationVerdict(
          [
            vendor('https://babeljs.io/blog/8.0.0'),
            vendor('https://babeljs.io/blog/8.0.1'),
          ],
          { allowVendorCrossClass: true },
        ),
      ).toMatchObject({ corroborated: false, reason: 'single_publisher' });
    });

    it('should not let a daily.dev mirror satisfy the community half', () => {
      expect(
        corroborationVerdict(
          [
            vendor('https://babeljs.io/blog/8.0.0'),
            community('https://app.daily.dev/posts/A'),
          ],
          { allowVendorCrossClass: true },
        ),
      ).toMatchObject({ corroborated: false });
    });
  });
});
