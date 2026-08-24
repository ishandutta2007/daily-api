import type { DataSource, EntityManager } from 'typeorm';
import { Claim, ClaimDateSource, ClaimStatus } from '../entity/claim/Claim';
import { evidenceDerivedDate } from './claimLedger';

type Con = DataSource | EntityManager;

// Claims a consumer actually reads. `rejected` rows are merge-absorbed: their
// evidence moved to the surviving claim, so they are undatable by construction
// and counting them makes a finished backfill look like a permanent backlog.
export const CONSUMABLE_STATUSES = [
  ClaimStatus.Candidate,
  ClaimStatus.Corroborated,
  ClaimStatus.Verified,
];

// The playbook's (smith-brain/docs/claim-ledger-review-playbook.md) R24
// marker, and the only sanctioned maturity wording in `versionScope` (§13
// forbids the rest). A claim about an unreleased line must
// keep `effectiveDate` NULL: nothing bites before GA, so a date here would
// place a change that has not happened.
//
// This is why the check lives next to the dating rules rather than in review
// procedure. The resolve route dates a claim from the post that reports it, so
// a pre-GA claim minted from a dated post would silently acquire a date and
// contradict R24 — leaving the operator to remember a manual null on every
// single one. Encoding it here is what makes that step unnecessary.
const PRE_RELEASE_MARKER = '(pre-release)';

export const isPreReleaseScope = (versionScope: string | null): boolean =>
  !!versionScope && versionScope.toLowerCase().includes(PRE_RELEASE_MARKER);

// The claims an evidence-derived date is ALLOWED on, and the date each one would
// get. Two filters make this a rule rather than a query: `rejected` rows are
// undatable by construction, and a pre-release row must stay NULL (R24) because
// the date on offer is a coverage date and nothing bites before GA.
//
// Exported because `bin/backfillClaimDates.ts` runs the same repair on demand.
// The script used to carry its own copy of this query with NEITHER filter, so
// every run re-dated the whole `(pre-release)` family that `clearPreReleaseDates`
// exists to keep NULL, and the next cron pass nulled them again — 660 rows on
// 2026-08-21. One home for the rule is what ends that loop: the script can no
// longer write a date the rules forbid, because it no longer decides who is
// datable.
export const planClaimDatesFromEvidence = async (
  con: Con,
): Promise<Map<string, string[]>> => {
  const undated = await con
    .getRepository(Claim)
    .createQueryBuilder('c')
    .select('c.id', 'id')
    .addSelect('MIN(COALESCE(e."publishedAt", p."publishedAt"))', 'publishedAt')
    .addSelect('MIN(p."createdAt")', 'createdAt')
    // Paired with the crawl date above so `evidenceDerivedDate` can tell a
    // source's opening archive sweep from a live crawl. MAX, because the two
    // MINs pick the earliest-crawled evidence post: pairing it with the LATEST
    // source registration is the reading that keeps a backfilled post looking
    // like one.
    .addSelect('MAX(s."createdAt")', 'sourceCreatedAt')
    .innerJoin('claim_evidence', 'e', 'e."claimId" = c.id')
    .leftJoin('post', 'p', 'p.id = e."postId"')
    .leftJoin('source', 's', 's.id = p."sourceId"')
    .where('c."effectiveDate" IS NULL')
    .andWhere('c.status IN (:...statuses)', { statuses: CONSUMABLE_STATUSES })
    .andWhere(
      `(c."versionScope" IS NULL OR lower(c."versionScope") NOT LIKE :marker)`,
      { marker: `%${PRE_RELEASE_MARKER}%` },
    )
    .groupBy('c.id')
    .getRawMany<{
      id: string;
      publishedAt: Date | null;
      createdAt: Date | null;
      sourceCreatedAt: Date | null;
    }>();

  // Evidence dates cluster hard, so one UPDATE per distinct (date, source)
  // beats one per claim by orders of magnitude.
  const groups = new Map<string, string[]>();

  undated.forEach((row) => {
    const derived = evidenceDerivedDate(row);

    if (!derived) {
      return;
    }

    const key = `${derived.effectiveDate}|${derived.dateSource}`;
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
  });

  return groups;
};

// Claims that gained evidence after they were created: the resolve route dates
// a claim from the post it cites at birth, so this only ever sees rows that
// were undatable then and became datable since.
export const dateClaimsFromEvidence = async (con: Con): Promise<number> => {
  const groups = await planClaimDatesFromEvidence(con);
  let dated = 0;

  for (const [key, ids] of groups) {
    const [effectiveDate, dateSource] = key.split('|');

    await con.getRepository(Claim).update(ids, {
      effectiveDate,
      dateSource: dateSource as ClaimDateSource,
    });

    dated += ids.length;
  }

  return dated;
};

// A claim whose displacement link points at its own entity says "X is replaced
// by X", which is not a displacement — it is version supersession mistaken for
// one, and it belongs in the statement and `versionScope` instead.
//
// Repaired at 248 rows on 2026-08-21 and recurring, because extraction keeps
// producing the shape: every one was "X version N is superseded by X version
// N+1". Left alone they also feed the describe queue's displacement arm, so
// they manufacture describe work whose "displaced approach" is the entity
// itself.
export const clearSelfDisplacementLinks = async (con: Con): Promise<number> => {
  const { affected } = await con
    .getRepository(Claim)
    .createQueryBuilder()
    .update()
    .set({ supersededByEntityId: null })
    .where('"supersededByEntityId" = "entityId"')
    .andWhere('status != :rejected', { rejected: ClaimStatus.Rejected })
    .execute();

  return affected ?? 0;
};

// The provenances R23 disqualifies before GA: both say "this is the date
// something REPORTED the change", and nothing bites before GA.
//
// Named positively on purpose. The first version of the repair below asked for
// `"dateSource" != 'extracted'` instead, which nulls every provenance nobody has
// thought about yet — a third source added later, or a row carrying a date with
// no `dateSource` at all, whose date this function would then destroy without
// ever being asked about it. A repair that deletes data may only act on the
// cases it can name.
const COVERAGE_DATE_SOURCES = [
  ClaimDateSource.EvidencePublished,
  ClaimDateSource.EvidenceCrawled,
];

// A pre-GA claim that acquired a coverage date before the rule above existed, or
// through a route that does not know about the marker. R24 wants these NULL
// until the GA flip sets them deliberately — an announced GA date (`extracted`)
// is the sanctioned exception and is left alone.
export const clearPreReleaseDates = async (con: Con): Promise<number> => {
  const { affected } = await con
    .getRepository(Claim)
    .createQueryBuilder()
    .update()
    .set({ effectiveDate: null, dateSource: null })
    .where(`lower("versionScope") LIKE :marker`, {
      marker: `%${PRE_RELEASE_MARKER}%`,
    })
    .andWhere('"effectiveDate" IS NOT NULL')
    .andWhere('"dateSource" IN (:...coverage)', {
      coverage: COVERAGE_DATE_SOURCES,
    })
    .andWhere('status != :rejected', { rejected: ClaimStatus.Rejected })
    .execute();

  return affected ?? 0;
};

// A claim dated from the day we CRAWLED the post, sitting on a post whose real
// publication date is now known. The crawl date was only ever a stand-in for a
// date we did not have — and a bad one on any archive import, because
// registering a source imports its whole archive at once, so a 2013 article and
// a 2026 article are crawled the same morning. Measured on prod 2026-08-23:
// 91.4% of these claims carry exactly the crawl date, and every one on a
// pre-2025 article is wrong by that article's own age.
//
// Deliberately narrow in three ways, because this OVERWRITES a date rather than
// filling an empty one:
//
//   - Only `evidence_crawled`. `extracted` is the change's own date, stated by
//     the post and possibly set by a reviewer who read it; `evidence_published`
//     is already the better provenance. Neither is this repair's business.
//   - Only where the post now has a `publishedAt`. Nothing is invented here —
//     the recovered date comes from the post row, so whatever fixes the posts
//     (a re-clean, a feed date now carried through) decides what this can reach.
//     Run it after the posts are repaired, not before.
//   - Only where the recovered date is EARLIER than the date on the claim. A
//     publication date later than our crawl of it is impossible, so those rows
//     are bad in some way this repair cannot name, and it leaves them alone.
//
// The two exclusions the dating planner applies are applied here for the same
// reasons: `rejected` rows are undatable by construction, and a pre-release row
// stays NULL under R24.
export const planCrawlDateRepairs = async (
  con: Con,
): Promise<Map<string, string[]>> => {
  const misdated = await con
    .getRepository(Claim)
    .createQueryBuilder('c')
    .select('c.id', 'id')
    .addSelect('MIN(p."publishedAt")', 'publishedAt')
    .innerJoin('claim_evidence', 'e', 'e."claimId" = c.id')
    .innerJoin('post', 'p', 'p.id = e."postId"')
    .where('c."dateSource" = :crawled', {
      crawled: ClaimDateSource.EvidenceCrawled,
    })
    .andWhere('c.status IN (:...statuses)', { statuses: CONSUMABLE_STATUSES })
    .andWhere(
      `(c."versionScope" IS NULL OR lower(c."versionScope") NOT LIKE :marker)`,
      { marker: `%${PRE_RELEASE_MARKER}%` },
    )
    .andWhere('p."publishedAt" IS NOT NULL')
    .groupBy('c.id')
    .addSelect('c."effectiveDate"', 'effectiveDate')
    .addGroupBy('c."effectiveDate"')
    .having('MIN(p."publishedAt")::date < c."effectiveDate"')
    .getRawMany<{ id: string; publishedAt: Date }>();

  // Recovered dates cluster on publication, so one UPDATE per distinct date
  // beats one per claim by orders of magnitude — the same shape the dating
  // planner uses.
  const groups = new Map<string, string[]>();

  misdated.forEach(({ id, publishedAt }) => {
    const date = publishedAt.toISOString().slice(0, 10);

    groups.set(date, [...(groups.get(date) ?? []), id]);
  });

  return groups;
};

export const repairCrawlDatedClaims = async (con: Con): Promise<number> => {
  const groups = await planCrawlDateRepairs(con);
  let repaired = 0;

  for (const [effectiveDate, ids] of groups) {
    await con.getRepository(Claim).update(ids, {
      effectiveDate,
      dateSource: ClaimDateSource.EvidencePublished,
    });

    repaired += ids.length;
  }

  return repaired;
};
