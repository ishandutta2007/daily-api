import type { DataSource, EntityManager } from 'typeorm';
import { ConflictError } from '../errors';
import { LedgerEntity } from '../entity/claim/LedgerEntity';
import { ClaimDateSource } from '../entity/claim/Claim';
import { ONE_DAY_IN_SECONDS } from './constants';

// A post that arrived within this of its source being registered came in that
// source's opening archive sweep, so the day we crawled it says nothing about
// the day it was published. Deliberately generous: the 2026-08-23 imports each
// drained inside ninety seconds, and the only thing a wide window costs is
// leaving the first day of a new source's genuinely fresh posts undated.
const ARCHIVE_IMPORT_WINDOW_MS = ONE_DAY_IN_SECONDS * 1000;

// The date a claim gets when extraction did not state one, derived from the
// post that reports it. Both fallbacks are an UPPER BOUND — a post published in
// June can describe a March change — which is exactly what `dateSource` records
// so a month-sliced study can exclude them (see product-wiki/claim-ledger.md
// §6: only `extracted` is the change's own date).
//
// Shared deliberately: the resolve route applies this when the claim is born
// and the hygiene cron applies it to claims that gained evidence later. Two
// copies of this rule would drift, and the field they write is the one every
// window query filters on.
export const evidenceDerivedDate = (
  source: {
    publishedAt?: Date | null;
    createdAt?: Date | null;
    sourceCreatedAt?: Date | null;
  } | null,
): { effectiveDate: string; dateSource: ClaimDateSource } | null => {
  // `effectiveDate` is a DATE column, so the timestamp is truncated to the day
  // it names — the same `::date` the backfill applies.
  const asDate = (value: Date): string => value.toISOString().slice(0, 10);

  if (source?.publishedAt) {
    return {
      effectiveDate: asDate(source.publishedAt),
      dateSource: ClaimDateSource.EvidencePublished,
    };
  }

  // The crawl date is only an upper bound worth recording when the crawl was
  // near the publication, and the one case where it plainly was not is a source
  // backfill: registering a source imports its whole archive at once, so a 2013
  // post and a 2026 post are both crawled this morning. Measured on prod
  // 2026-08-23 — of 12,468 claims dated this way, 91.4% carry exactly the crawl
  // date, and EVERY claim on a pre-2025 article is wrong by the article's own
  // age (2022 articles drift four years).
  //
  // The direction is what makes it worse than an ordinary imprecision. M1 denies
  // a candidate whose `effectiveDate` is older than 24 months, so a decade-old
  // fact stamped with today's date does not merely arrive misdated — it walks
  // straight through the staleness bar that exists to catch it and enters the
  // ledger reading as current. An undated claim is the honest outcome here
  // (playbook §10), and it leaves the row visible to the review lane instead.
  if (source?.createdAt && isLiveCrawl(source)) {
    return {
      effectiveDate: asDate(source.createdAt),
      dateSource: ClaimDateSource.EvidenceCrawled,
    };
  }

  return null;
};

// Phrased as "prove this was a live crawl" rather than "prove this was an
// archive import", because the two differ when `sourceCreatedAt` is missing and
// that difference decides whether a future caller reintroduces the bug by
// forgetting a field. Unable-to-tell yields no date, which costs a claim its
// upper bound; the other way round it silently mints the wrong date again.
const isLiveCrawl = ({
  createdAt,
  sourceCreatedAt,
}: {
  createdAt?: Date | null;
  sourceCreatedAt?: Date | null;
}): boolean =>
  !!createdAt &&
  !!sourceCreatedAt &&
  createdAt.getTime() - sourceCreatedAt.getTime() >= ARCHIVE_IMPORT_WINDOW_MS;

// Params that name a syndication channel rather than a document.
const TRACKING_PARAM_PREFIXES = ['utm_', 'ref_', 'mc_', 'mkt_', 'pk_'];
const TRACKING_PARAMS = new Set([
  'ref',
  'source',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'igshid',
  'mkt_tok',
  'at_medium',
]);

const isTrackingParam = (key: string): boolean => {
  const name = key.toLowerCase();

  return (
    TRACKING_PARAMS.has(name) ||
    TRACKING_PARAM_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
};

// The ledger's cross-lane identity key: a feed hands us the same document as a
// post does, wearing `?utm_source=rss`, a `www.` host or plain http. Stricter
// than `normalizeEvidenceUrl` and separate from it, because that one's output
// is already persisted in `claim_evidence.url`.
export const canonicalDocumentUrl = (url: string): string => {
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return trimmed;
    }

    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    parsed.username = '';
    parsed.password = '';
    // A fragment addresses a section of a document, not another document.
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';

    const params = [...parsed.searchParams.entries()]
      .filter(([key]) => !isTrackingParam(key))
      .sort(([a], [b]) => (a < b ? -1 : 1));

    parsed.search = params.length ? new URLSearchParams(params).toString() : '';

    return parsed.toString();
  } catch {
    return trimmed;
  }
};

const MAX_HIERARCHY_DEPTH = 5;

// Evidence dedupes on (claimId, url), so one source filed once with a trailing
// slash and once without counted twice towards corroboration. Only the trailing
// slash is trimmed: case and query strings can pick out a different page.
export const normalizeEvidenceUrl = (url: string): string => {
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, '');

    // A bare origin has nothing but the slash, and dropping it would leave the
    // url without a path at all.
    if (!pathname || pathname === parsed.pathname) {
      return trimmed;
    }

    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return trimmed;
  }
};

// The canonical name and every alias — code-only included, since a name is
// unique across the whole ledger no matter which array holds it — lowercased
// into one array. Declared as an immutable function so a GIN index can be
// built over it: matching with && then answers the whole lookup from the
// index, where the equivalent lower() and unnest() predicates force a
// sequential scan.
const searchNames =
  'ledger_entity_search_names(le."canonicalName", le."aliases", le."codeOnlyAliases")';

export const findLedgerEntitiesByName = ({
  con,
  names,
}: {
  con: DataSource | EntityManager;
  names: string[];
}): Promise<LedgerEntity[]> =>
  con
    .getRepository(LedgerEntity)
    .createQueryBuilder('le')
    .select([
      'le.id',
      'le.canonicalName',
      'le.kind',
      'le.aliases',
      'le.codeOnlyAliases',
      'le.codeOnlyCanonical',
      'le.ecosystem',
      'le.parentId',
    ])
    .where(`${searchNames} && :names`, {
      names: names.map((name) => name.trim().toLowerCase()),
    })
    .getMany();

// The extractor names the replacement as a string, and a name resolves to an
// entity only if one already exists: an entity minted here would carry no claim
// of its own, and entities are demand-driven. Ambiguity resolves to null rather
// than a guess — a wrong displacement link points a reader at the wrong
// replacement, which is worse than an absent one, so it goes to review instead.
// Anything that qualifies a name: whitespace, and the punctuation registry
// identifiers are built from (`app-router`, `laravel/framework`, `@scope/pkg`).
const NAME_QUALIFIER = /[-\s/@._:]/;

// A single-word alias of a qualified name drops the very word that makes it
// unique — "Konnect" for "Kong Konnect", "Neo" for "Pulumi Neo". Uniqueness
// INSIDE the ledger does not make such a name unambiguous in the world, so it
// matches products the ledger has never heard of and the link points a reader
// at an unrelated replacement. Machine identifiers are exempt: they carry their
// own qualifier and are what a lockfile actually says.
const isUnderqualifiedAlias = ({
  entity,
  name,
}: {
  entity: LedgerEntity;
  name: string;
}): boolean => {
  const canonicalName = entity.canonicalName.trim();

  if (name === canonicalName.toLowerCase()) {
    return false;
  }

  return !NAME_QUALIFIER.test(name) && NAME_QUALIFIER.test(canonicalName);
};

export const resolveSupersededByEntityId = async ({
  con,
  name,
  statement,
}: {
  con: DataSource | EntityManager;
  name: string | null;
  statement?: string | null;
}): Promise<string | null> => {
  if (!name) {
    return null;
  }

  const matches = await findLedgerEntitiesByName({ con, names: [name] });

  if (matches.length !== 1) {
    return null;
  }

  const [entity] = matches;
  const matchedName = name.trim().toLowerCase();

  // The claim naming the replacement in full is the corroboration a bare word
  // cannot supply on its own. Without it the link stays empty and goes to
  // review, which is the same answer ambiguity already gets.
  if (
    isUnderqualifiedAlias({ entity, name: matchedName }) &&
    !(statement ?? '')
      .toLowerCase()
      .includes(entity.canonicalName.trim().toLowerCase())
  ) {
    return null;
  }

  return entity.id;
};

// Every name an entity answers to must be unique across the whole ledger,
// otherwise a claim can be filed against two different rows for one artifact.
export const assertLedgerNamesAvailable = async ({
  con,
  names,
  excludeId,
}: {
  con: DataSource | EntityManager;
  names: string[];
  excludeId?: string;
}): Promise<void> => {
  const taken = (await findLedgerEntitiesByName({ con, names })).filter(
    (entity) => entity.id !== excludeId,
  );

  if (taken.length) {
    throw new ConflictError(
      `Ledger entity name already in use by "${taken[0].canonicalName}"`,
    );
  }
};

// Claims filed against a child entity answer questions about its parent, so a
// query for "next.js" must also return claims about "next.js app router".
export const expandLedgerEntityIds = async ({
  con,
  entityIds,
}: {
  con: DataSource | EntityManager;
  entityIds: string[];
}): Promise<string[]> => {
  const collected = new Set(entityIds);
  let frontier = entityIds;

  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && frontier.length; depth++) {
    const children = await con
      .getRepository(LedgerEntity)
      .createQueryBuilder('le')
      .select(['le.id'])
      .where('le."parentId" = ANY(:parentIds)', { parentIds: frontier })
      .getMany();

    frontier = children.map(({ id }) => id).filter((id) => !collected.has(id));
    frontier.forEach((id) => collected.add(id));
  }

  return [...collected];
};
