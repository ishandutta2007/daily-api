import type { FastifyLoggerInstance } from 'fastify';
import type { DataSource } from 'typeorm';
import {
  ClaimChangeType as ProtoClaimChangeType,
  ClaimDirectness as ProtoClaimDirectness,
  ClaimEntityKind as ProtoClaimEntityKind,
  ContentFormat,
} from '@dailydotdev/schema';
import { ClaimChangeType } from '../entity/claim/Claim';
import {
  ClaimCandidate,
  ClaimDirectness,
} from '../entity/claim/ClaimCandidate';
import { LedgerDocument } from '../entity/claim/LedgerDocument';
import { LedgerEntityKind } from '../entity/claim/LedgerEntity';
import { Post } from '../entity/posts/Post';
import { downloadTextFromUri } from './googleCloud';
import { isTooGenericToEmit } from './signatureSpecificity';
import { isEntityPhrase, loadProseEntityNames } from './ledgerEntityNames';
import { canonicalDocumentUrl } from './claimLedger';
import { getBragiClient } from '../integrations/bragi/clients';

const changeTypeMap: Record<number, ClaimChangeType> = {
  [ProtoClaimChangeType.BREAKING]: ClaimChangeType.Breaking,
  [ProtoClaimChangeType.DEPRECATION]: ClaimChangeType.Deprecation,
  [ProtoClaimChangeType.REMOVAL]: ClaimChangeType.Removal,
  [ProtoClaimChangeType.RELEASE]: ClaimChangeType.Release,
  [ProtoClaimChangeType.NEW_CAPABILITY]: ClaimChangeType.NewCapability,
  [ProtoClaimChangeType.DISPLACEMENT]: ClaimChangeType.Displacement,
  [ProtoClaimChangeType.CONSENSUS_SHIFT]: ClaimChangeType.ConsensusShift,
  [ProtoClaimChangeType.GOTCHA]: ClaimChangeType.Gotcha,
  [ProtoClaimChangeType.SECURITY]: ClaimChangeType.Security,
  [ProtoClaimChangeType.FIX]: ClaimChangeType.Fix,
  [ProtoClaimChangeType.PRICING]: ClaimChangeType.Pricing,
};

const entityKindMap: Record<number, LedgerEntityKind> = {
  [ProtoClaimEntityKind.PACKAGE]: LedgerEntityKind.Package,
  [ProtoClaimEntityKind.MODEL]: LedgerEntityKind.Model,
  [ProtoClaimEntityKind.API]: LedgerEntityKind.Api,
  [ProtoClaimEntityKind.SPEC]: LedgerEntityKind.Spec,
  [ProtoClaimEntityKind.SERVICE]: LedgerEntityKind.Service,
  [ProtoClaimEntityKind.TOOL]: LedgerEntityKind.Tool,
  [ProtoClaimEntityKind.RUNTIME]: LedgerEntityKind.Runtime,
  [ProtoClaimEntityKind.OTHER]: LedgerEntityKind.Other,
};

const directnessMap: Record<number, ClaimDirectness> = {
  [ProtoClaimDirectness.ANNOUNCEMENT]: ClaimDirectness.Announcement,
  [ProtoClaimDirectness.REPORT]: ClaimDirectness.Report,
  [ProtoClaimDirectness.FIRSTHAND]: ClaimDirectness.Firsthand,
};

const toDateColumn = (value: string): string | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : null;
};

export type ClaimExtractionTarget =
  | { postId: string; documentId?: never }
  | { postId?: never; documentId: string };

const targetColumn = (target: ClaimExtractionTarget): string =>
  target.postId ? 'postId' : 'documentId';

const targetId = ({ postId, documentId }: ClaimExtractionTarget): string =>
  postId ?? (documentId as string);

// Must read the primary: replica lag here lets a redelivery extract twice.
export const loadFiledStatements = async ({
  con,
  target,
}: {
  con: DataSource;
  target: ClaimExtractionTarget;
}): Promise<string[]> => {
  const filed = await con
    .getRepository(ClaimCandidate)
    .createQueryBuilder('cc')
    .select('cc.statement', 'statement')
    .where(`cc."${targetColumn(target)}" = :id`, { id: targetId(target) })
    .getRawMany<{ statement: string }>();

  return filed.map(({ statement }) => statement);
};

export const extractAndFileClaims = async ({
  con,
  logger,
  target,
  filed,
  uri,
  content: inlineContent,
  title,
  contentFormat,
  url,
  source,
  publishedAt,
  logDetails,
}: {
  con: DataSource;
  logger: FastifyLoggerInstance;
  target: ClaimExtractionTarget;
  filed: string[];
  uri: string | null;
  content: string | null;
  title: string;
  contentFormat: ContentFormat;
  url: string;
  source: string;
  publishedAt: Date | null;
  logDetails: Record<string, unknown>;
}): Promise<void> => {
  try {
    // Handed to bragi verbatim: evidence spans must match the content exactly.
    const content = uri ? await downloadTextFromUri(uri) : inlineContent;

    if (!content) {
      return;
    }

    const bragiClient = getBragiClient();
    const response = await bragiClient.garmr.execute(() =>
      bragiClient.instance.extractClaims({
        // Correlation only, unread by bragi's handler, so the document lane
        // borrows the field.
        postId: targetId(target),
        title,
        contentFormat,
        content,
        url,
        source,
        // Bragi resolves relative expressions ("last month", "since March")
        // against this, so defaulting it to today dates an old document's
        // claims as recent. Empty leaves them unresolved, which yields no date
        // rather than a wrong one.
        publishedDate: publishedAt?.toISOString().slice(0, 10) ?? '',
      }),
    );

    const statements = new Set(filed.map((statement) => statement.trim()));

    const proseEntityNames = await loadProseEntityNames(con);
    const usableSignature = (token: string): boolean =>
      !isTooGenericToEmit(token) && !isEntityPhrase(token, proseEntityNames);

    const candidates = response.claims.reduce<Partial<ClaimCandidate>[]>(
      (acc, claim) => {
        const changeType = changeTypeMap[claim.changeType];
        const statement = claim.statement.trim();

        if (
          !changeType ||
          !claim.entityName ||
          !statement ||
          statements.has(statement)
        ) {
          return acc;
        }

        statements.add(statement);
        acc.push({
          postId: target.postId ?? null,
          documentId: target.documentId ?? null,
          rawEntityName: claim.entityName,
          entityAliases: claim.entityAliases,
          entityKind: entityKindMap[claim.entityKind] ?? LedgerEntityKind.Other,
          changeType,
          statement,
          versionScope: claim.versionScope || null,
          effectiveDate: toDateColumn(claim.effectiveDate),
          sunsetDate: toDateColumn(claim.sunsetDate),
          supersededBy: claim.supersededBy || null,
          directness: directnessMap[claim.directness] ?? ClaimDirectness.Report,
          evidence: claim.evidence,
          // Signatures match by exact equality, so a generic token ("name",
          // "GET") would fire on every codebase.
          affected: claim.affected.filter(usableSignature),
          superseding: claim.superseding.filter(usableSignature),
        });

        return acc;
      },
      [],
    );

    if (!candidates.length) {
      return;
    }

    // The lane froze on a read taken a whole extraction ago, so two deliveries
    // can both have found the target unextracted. Growth rather than presence,
    // because the document lane re-extracts a rolling page that already has
    // candidates.
    const raced = await loadFiledStatements({ con, target });

    if (raced.length > filed.length) {
      logger.debug(logDetails, 'Claims filed by a concurrent extraction');
      return;
    }

    await con
      .createQueryBuilder()
      .insert()
      .into(ClaimCandidate)
      .values(candidates)
      .orIgnore()
      .execute();
  } catch (err) {
    logger.error({ ...logDetails, err }, 'Failed to extract claims');
    throw err;
  }
};

// A vendor changelog can also reach the feed as a post. Extracting it twice
// pays bragi twice and hands reviewers two candidate sets to merge by hand, so
// whichever lane arrives second stands down.
export const isCoveredByOtherLane = async ({
  con,
  target,
  url,
}: {
  con: DataSource;
  target: ClaimExtractionTarget;
  url: string;
}): Promise<boolean> => {
  const canonical = canonicalDocumentUrl(url);

  if (target.postId) {
    const document = await con
      .getRepository(LedgerDocument)
      .createQueryBuilder('ld')
      .select('ld.id', 'id')
      .where('ld.url = :canonical', { canonical })
      .andWhere('ld."extractedAt" IS NOT NULL')
      .limit(1)
      .getRawOne<{ id: string }>();

    return !!document;
  }

  // Post urls are stored as yggdrasil found them, so both spellings are tried
  // rather than one canonical form.
  const urls = [...new Set([url.trim(), canonical])];
  const covered = await con
    .getRepository(ClaimCandidate)
    .createQueryBuilder('cc')
    .select('cc.id', 'id')
    .innerJoin(Post, 'p', 'p.id = cc."postId"')
    .where('p.url IN (:...urls) OR p."canonicalUrl" IN (:...urls)', { urls })
    .limit(1)
    .getRawOne<{ id: string }>();

  return !!covered;
};
