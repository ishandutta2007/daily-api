import type { DataSource, EntityManager } from 'typeorm';
import { Claim, ClaimStatus } from '../entity/claim/Claim';
import { ClaimEvidenceSourceClass } from '../entity/claim/ClaimEvidence';
import { distinctPublishers, evidencePublisher } from './evidencePublisher';

type Con = DataSource | EntityManager;

// WHAT THIS MODULE GUARANTEES
//
// `ClaimStatus.Corroborated` was an enum value nothing computed. Every claim is
// born `candidate` by `/candidates/resolve` and only an explicit
// `POST /claims/status` moved it, so the status meant "a reviewer got to it",
// not "the evidence supports it" — and the plan-reviewer, which floors at
// `corroborated`, inherited a recall bound set by review capacity.
//
// This module computes it from the evidence pile, and guarantees:
//
//  1. It only ever promotes `candidate` -> `corroborated`. It NEVER demotes,
//     never touches `verified` or `rejected`, and never revisits a claim that is
//     already `corroborated`. `verified` is a property of the REVIEW PERFORMED
//     (playbook §2) and no amount of evidence can earn it — law 1, "corroboration
//     counts NEVER promote to verified".
//  2. `sourceClass` can never PROMOTE. It is read in exactly one place and in
//     exactly one direction: `registry` rows are DROPPED before counting (see
//     PROVENANCE ROWS below), so relabelling a row can only ever cost a claim
//     corroboration, never earn it. That is law 3 ("sourceClass upgrades never
//     promote") made structural rather than remembered — the same guarantee the
//     original "not an input at all" reading gave, minus the false promotions it
//     could not see.
//  3. It is idempotent. A promoted claim is no longer `candidate`, so a second
//     run selects nothing; the verdict itself is a pure function of the evidence.
//
// THE CRITERION, and why this reading of it
//
// A `candidate` claim becomes `corroborated` when its evidence names >= 2
// DISTINCT PUBLISHERS, where a publisher is the registrable domain of the
// evidence url (see `evidencePublisher.ts` for how that identity is built).
//
// The playbook stated this twice and not identically. The §2 heading says
// "**>= 2 independent sources**"; the sentence under it makes the operational
// test "distinct POSTS, not candidate rows", with an RT-mirror carve-out. Those
// are different rules and prod knows the difference: 3,498 candidate claims have
// >= 2 distinct posts, 2,415 have >= 2 distinct publishers, so the reading is
// worth 1,049 claims. The wiki records the question being raised rather than
// settled (§6h, on the Babel claim whose two posts were both babeljs.io).
//
// Settled here as INDEPENDENT PUBLISHERS, for three reasons:
//   - "Independent" is the word in the heading, and one vendor blog posting
//     twice is not independent of itself under any reading.
//   - Precision over recall is the ledger's standing bias (playbook §1), and
//     this is the strictly more precise of the two readings.
//   - The distinct-POSTS test needs the RT carve-out bolted on precisely because
//     it counts mirrors as sources. Publishers subsume that carve-out for free:
//     every retweet already resolves to one x.com.
//
// PROVENANCE ROWS DO NOT CORROBORATE
//
// A registry page attests that a version EXISTS and when it shipped. It does not
// attest the behavioural fact in the claim's statement — hex.pm knows composite
// 0.7.0 was published on 2026-08-22, it does not know that 0.7.0 raised its
// minimum Elixir version. Counting it as a publisher is therefore not a
// corroboration at all; it is provenance wearing a second domain name.
//
// This was not theoretical. Playbook R15a instructs the operator, on resolving a
// survivor's `versionScope` to a ship date, to SET `effectiveDate` and record the
// registry read via `POST /claims/evidence`. Under the pre-existing rule that
// audit row was also a second registrable domain, so obeying R15a on a
// single-sourced package release silently promoted it: one Medium post by the
// package author + packagist.org = `corroborated`. Every R15a date resolution on
// a single-sourced release has that shape, and nothing downstream could see it —
// this cron never demotes and the plan-reviewer floors at `corroborated`. The
// operator caught it by withholding the evidence rows and escalating
// (#rot-bench, 2026-08-22), which cost the audit trail R15a exists to create.
//
// So: a `registry` row published by a PACKAGE REGISTRY is dropped before the
// publisher count, and the operator writes the evidence row. The ledger keeps
// the provenance and does not mistake it for a second opinion.
//
// COST, measured rather than assumed: over the whole prod pile there are 11
// `registry` evidence rows on 11 claims; 3 sit on a package-registry host, and
// ZERO claims at any status depend on one to reach two publishers. Today this
// promotes nobody and demotes nobody; it is a guard on the rows R15a is about to
// start writing.
//
// The recall it forgoes is a package-registry page that genuinely attests the
// statement (a yanked crate, a deprecation flag). That path is not closed, it is
// just not automatic: a human who READS that page promotes it under R12, which
// is what `verified` means.
//
// VENDOR CROSS-CLASS, available and off
//
// product-wiki §3 names "changelog confirms + community reports breakage" the
// strongest signal, which argues for a second branch: >= 1 vendor/registry row
// plus >= 1 other row, even from one publisher. It is implemented below and
// DEFAULT OFF, because measuring it turned a design argument into an easy call:
//
//   - it promotes 20 additional claims today (0.8% on top of 2,415), while
//   - the population it opens up is 1,049 claims that have >= 2 posts from a
//     single publisher, every one of which would promote the moment a row was
//     relabelled `vendor_changelog`.
//
// That relabelling is not hypothetical — bulk reclassification against a
// vendor-primary url pattern set is explicitly sanctioned (playbook §2, law 3,
// Ido 2026-08-18) and law 3 exists because ignoring it once cost 104
// over-promotions. Twenty claims of recall is not worth putting a hard law
// behind an operator's discipline. Flip `allowVendorCrossClass` if that trade
// ever changes; the tests prove both directions.
//
// NO RECENCY FILTER. Open thread 8 pairs corroboration with "claim recency
// filtering", but neither the playbook nor the wiki states what that rule would
// be, and this module will not invent one. The nearest written rule, M1, denies
// PENDING CANDIDATES older than 24 months at review time — a different object at
// a different stage. Corroboration here is time-blind: an old claim with two
// independent publishers is corroborated, and whether a consumer wants it is the
// serving query's `since` filter to decide.

// PACKAGE registries: the hosts whose pages answer "does this version exist and
// when was it published" and nothing else. A `registry` row on one of these is
// dropped before the publisher count; see PROVENANCE ROWS.
//
// A HOST LIST and not the whole `registry` class, because reading how the class
// is actually used in prod settles it: of 11 registry rows, 8 are nvd.nist.gov,
// cvedetails.com, rubysec.com and huggingface.co. An NVD page is not provenance
// — it attests the vulnerability, its severity and its affected range, which IS
// the fact a security claim states. Dropping those would cost real corroboration
// to fix a package-release problem they have no part in.
//
// The vocabulary is the ten ecosystems of playbook E12 (`ClaimEntity.ecosystem`),
// one entry per registry that can attest a release. `github.com` is deliberately
// absent even though 2 rows carry `registry:github.com`: a release page there is
// the vendor's own notes, which do attest behaviour.
const PACKAGE_REGISTRY_PUBLISHERS: ReadonlySet<string> = new Set([
  'npmjs.org', // npm
  'pypi.org', // pypi
  'rubygems.org', // rubygems
  'golang.org', // go — proxy.golang.org
  'go.dev', // go — pkg.go.dev
  'crates.io', // crates
  'maven.org', // maven — search.maven.org, repo1.maven.org
  'mvnrepository.com', // maven
  'packagist.org', // packagist — also repo.packagist.org
  'hex.pm', // hex
  'nuget.org', // nuget
  'pub.dev', // pub
]);

// The classes that speak for the thing itself rather than about it. Used only by
// the off-by-default branch below. `Registry` is deliberately NOT here: a
// package-registry row is already gone by the time this is consulted, and
// listing the class would let the opt-in branch re-open the exact hole the drop
// closes — for every registry row, not just the substantive ones.
const OFFICIAL_SOURCE_CLASSES: ReadonlySet<string> = new Set([
  ClaimEvidenceSourceClass.VendorChangelog,
]);

export type CorroborationEvidence = {
  url: string;
  sourceClass: ClaimEvidenceSourceClass | string;
};

export type CorroborationReason =
  | 'distinct_publishers'
  | 'vendor_cross_class'
  | 'single_publisher'
  | 'no_independent_evidence';

// A row that attests provenance only: a `registry` row published by a package
// registry. Both halves are required — the class alone sweeps in NVD, and the
// host alone would drop a genuine article that happens to live on a registry
// domain. Kept as a named predicate so the one place `sourceClass` is read in
// the default path is greppable.
const isProvenanceOnly = ({
  url,
  sourceClass,
}: CorroborationEvidence): boolean => {
  if (sourceClass !== ClaimEvidenceSourceClass.Registry) {
    return false;
  }

  const publisher = evidencePublisher(url);

  return !!publisher && PACKAGE_REGISTRY_PUBLISHERS.has(publisher);
};

export type CorroborationVerdict = {
  corroborated: boolean;
  reason: CorroborationReason;
  publishers: string[];
};

// The whole rule, as one pure function over one claim's evidence rows. Every
// caller — cron, backfill, test — goes through this; there is no second copy of
// the criterion anywhere.
export const corroborationVerdict = (
  evidence: CorroborationEvidence[],
  { allowVendorCrossClass = false }: { allowVendorCrossClass?: boolean } = {},
): CorroborationVerdict => {
  // The only read of `sourceClass` in the default path, and it is subtractive:
  // dropping rows can move a verdict from corroborated to not, never the reverse.
  const attesting = evidence.filter((row) => !isProvenanceOnly(row));
  const publishers = distinctPublishers(attesting.map(({ url }) => url));

  if (publishers.length >= 2) {
    return { corroborated: true, reason: 'distinct_publishers', publishers };
  }

  // Rows that name no publisher at all (unparseable urls, our own permalinks)
  // are already gone from `publishers`, but they must also not prop up the
  // cross-class branch: a vendor changelog corroborated by a daily.dev
  // Collection is the self-citation the exclusion exists to stop.
  const independent = attesting.filter(({ url }) => evidencePublisher(url));

  if (allowVendorCrossClass && publishers.length === 1) {
    const official = independent.filter(({ sourceClass }) =>
      OFFICIAL_SOURCE_CLASSES.has(sourceClass),
    );
    const other = independent.filter(
      ({ sourceClass }) => !OFFICIAL_SOURCE_CLASSES.has(sourceClass),
    );

    if (official.length >= 1 && other.length >= 1) {
      return { corroborated: true, reason: 'vendor_cross_class', publishers };
    }
  }

  return {
    corroborated: false,
    reason: publishers.length ? 'single_publisher' : 'no_independent_evidence',
    publishers,
  };
};

export type CorroborationPlanRow = {
  claimId: string;
  verdict: CorroborationVerdict;
};

// Which `candidate` claims the criterion promotes, without writing anything.
//
// The status filter is the never-demote guarantee expressed as a WHERE clause
// rather than as care: rows that are already `corroborated`, or that a reviewer
// moved to `verified` or `rejected`, are never even selected, so no bug in the
// verdict below can reach them.
//
// Exported so `bin/backfillClaimCorroboration.ts --dry-run` reports exactly what
// the cron would do, from the same query and the same rule.
export const planClaimCorroboration = async (
  con: Con,
  options: { allowVendorCrossClass?: boolean } = {},
): Promise<CorroborationPlanRow[]> => {
  const rows = await con
    .getRepository(Claim)
    .createQueryBuilder('c')
    .select('c.id', 'id')
    .addSelect(
      `json_agg(json_build_object('url', e.url, 'sourceClass', e."sourceClass"))`,
      'evidence',
    )
    .innerJoin('claim_evidence', 'e', 'e."claimId" = c.id')
    .where('c.status = :status', { status: ClaimStatus.Candidate })
    .groupBy('c.id')
    .getRawMany<{ id: string; evidence: CorroborationEvidence[] }>();

  return rows.map(({ id, evidence }) => ({
    claimId: id,
    verdict: corroborationVerdict(evidence ?? [], options),
  }));
};

// Promote everything the plan says qualifies, and report what happened by
// reason. The update repeats the status filter so a claim a reviewer moved
// between the plan and the write is left alone.
export const corroborateClaims = async (
  con: Con,
  options: { allowVendorCrossClass?: boolean } = {},
): Promise<Record<CorroborationReason, number>> => {
  const plan = await planClaimCorroboration(con, options);
  const counts: Record<CorroborationReason, number> = {
    distinct_publishers: 0,
    vendor_cross_class: 0,
    single_publisher: 0,
    no_independent_evidence: 0,
  };

  plan.forEach(({ verdict }) => {
    counts[verdict.reason] += 1;
  });

  const promote = plan
    .filter(({ verdict }) => verdict.corroborated)
    .map(({ claimId }) => claimId);

  // One UPDATE per chunk rather than per claim: the first prod run promotes
  // thousands of rows and `update(ids, ...)` builds an IN list.
  for (let index = 0; index < promote.length; index += 500) {
    await con
      .getRepository(Claim)
      .createQueryBuilder()
      .update()
      .set({ status: ClaimStatus.Corroborated })
      .whereInIds(promote.slice(index, index + 500))
      .andWhere('status = :status', { status: ClaimStatus.Candidate })
      .execute();
  }

  return counts;
};
