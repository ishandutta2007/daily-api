import {
  ContentFormat,
  LedgerContentFormat,
  LedgerDocumentPublishedMessage,
  LedgerSourceClass,
} from '@dailydotdev/schema';
import type { TypedWorker } from './worker';
import { ClaimEvidenceSourceClass } from '../entity/claim/ClaimEvidence';
import {
  LedgerDocument,
  LedgerDocumentFormat,
} from '../entity/claim/LedgerDocument';
import {
  extractAndFileClaims,
  isCoveredByOtherLane,
  loadFiledStatements,
} from '../common/claimExtraction';
import { canonicalDocumentUrl } from '../common/claimLedger';

// Keyed by number so a value minted by a newer producer falls through to the
// default rather than writing undefined into a NOT NULL column.
const sourceClassMap: Record<number, ClaimEvidenceSourceClass> = {
  [LedgerSourceClass.UNSPECIFIED]: ClaimEvidenceSourceClass.Community,
  [LedgerSourceClass.VENDOR_CHANGELOG]:
    ClaimEvidenceSourceClass.VendorChangelog,
  [LedgerSourceClass.REGISTRY]: ClaimEvidenceSourceClass.Registry,
  [LedgerSourceClass.COMMUNITY]: ClaimEvidenceSourceClass.Community,
};

// Mapped, never cast: the ledger contract and bragi's ContentFormat number the
// same three formats differently (bragi's XML is 0, this one's is 1).
const documentFormatMap: Record<number, LedgerDocumentFormat> = {
  [LedgerContentFormat.XML]: LedgerDocumentFormat.Xml,
  [LedgerContentFormat.MARKDOWN]: LedgerDocumentFormat.Markdown,
  [LedgerContentFormat.HTML]: LedgerDocumentFormat.Html,
};

const bragiFormatMap: Record<number, ContentFormat> = {
  [LedgerContentFormat.XML]: ContentFormat.XML,
  [LedgerContentFormat.MARKDOWN]: ContentFormat.Markdown,
  [LedgerContentFormat.HTML]: ContentFormat.HTML,
};

// No `change_signal` gate, unlike the post lane: this lane skips enrichment
// entirely, and its sources exist to announce the changes it extracts.
const worker: TypedWorker<'yggdrasil.v1.ledger-document-published'> = {
  subscription: 'api.ledger-document-published-extract-claims',
  handler: async ({ data, messageId }, con, logger): Promise<void> => {
    const { documentId, url, contentLocation } = data;
    const documentFormat = documentFormatMap[data.contentFormat];

    if (!documentId || !url || !contentLocation || !documentFormat) {
      return;
    }

    const canonicalUrl = canonicalDocumentUrl(url);
    const columns = {
      sourceId: data.sourceId,
      url: canonicalUrl,
      title: data.title,
      sourceName: data.sourceName,
      sourceClass:
        sourceClassMap[data.sourceClass] ?? ClaimEvidenceSourceClass.Community,
      // Unix seconds; absent means the source stated no date.
      publishedAt:
        typeof data.publishedAt === 'undefined'
          ? null
          : new Date(Number(data.publishedAt) * 1000),
      contentLocation,
      contentFormat: documentFormat,
      contentHash: data.contentHash,
    };

    const repository = con.getRepository(LedgerDocument);
    // The primary key settles two concurrent deliveries; the loser reads the
    // winner's row back.
    await con
      .createQueryBuilder()
      .insert()
      .into(LedgerDocument)
      .values({ id: documentId, ...columns })
      .orIgnore()
      .execute();

    const document = await repository.findOneBy({ id: documentId });

    if (!document) {
      throw new Error(
        `Ledger document disappeared after insert: ${documentId}`,
      );
    }

    if (document.contentHash !== columns.contentHash) {
      await repository.update(document.id, { ...columns, extractedAt: null });
    } else if (document.extractedAt) {
      return;
    }

    const target = { documentId: document.id };
    const filed = await loadFiledStatements({ con, target });

    if (await isCoveredByOtherLane({ con, target, url: canonicalUrl })) {
      // Stamped so the lookup does not repeat on every redelivery.
      await repository.update(document.id, { extractedAt: new Date() });

      return;
    }

    await extractAndFileClaims({
      con,
      logger,
      target,
      filed,
      uri: contentLocation,
      content: null,
      title: columns.title,
      contentFormat: bragiFormatMap[data.contentFormat],
      url: canonicalUrl,
      source: columns.sourceName || columns.sourceId,
      // Never the crawl date as a stand-in: bragi would resolve the content's
      // relative expressions against the wrong year.
      publishedAt: columns.publishedAt,
      logDetails: { documentId, messageId },
    });

    // Stamped even when nothing was filed, so a document with no claims to
    // give is not re-extracted on every redelivery.
    await repository.update(document.id, { extractedAt: new Date() });
  },
  parseMessage: (message) =>
    LedgerDocumentPublishedMessage.fromBinary(message.data),
};

export default worker;
