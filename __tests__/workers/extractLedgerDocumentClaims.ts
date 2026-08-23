import { createClient, createRouterTransport } from '@connectrpc/connect';
import { Storage } from '@google-cloud/storage';
import {
  Claim as ProtoClaim,
  ClaimChangeType as ProtoClaimChangeType,
  ClaimDirectness as ProtoClaimDirectness,
  ClaimEntityKind as ProtoClaimEntityKind,
  ContentFormat,
  ExtractClaimsResponse,
  LedgerContentFormat,
  LedgerDocumentPublishedMessage,
  LedgerSourceClass,
  Pipelines,
} from '@dailydotdev/schema';
import type { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import {
  createGarmrMock,
  expectSuccessfulTypedBackground,
  saveFixtures,
} from '../helpers';
import worker from '../../src/workers/extractLedgerDocumentClaims';
import { typedWorkers } from '../../src/workers';
import { ClaimChangeType } from '../../src/entity/claim/Claim';
import {
  ClaimCandidate,
  ClaimDirectness,
} from '../../src/entity/claim/ClaimCandidate';
import { ClaimEvidenceSourceClass } from '../../src/entity/claim/ClaimEvidence';
import {
  LedgerDocument,
  LedgerDocumentFormat,
} from '../../src/entity/claim/LedgerDocument';
import { LedgerEntityKind } from '../../src/entity/claim/LedgerEntity';
import { ArticlePost } from '../../src/entity/posts/ArticlePost';
import { Source } from '../../src/entity/Source';
import { sourcesFixture } from '../fixture/source';
import * as bragiClients from '../../src/integrations/bragi/clients';
import type { ServiceClient } from '../../src/types';

jest.mock('@google-cloud/storage');

const mockDownload = jest.fn();
const mockExtractClaims = jest.fn();

const notes = '# 4.2.0\n\nThe legacy `render` export is removed.';

const createTransport = () =>
  createRouterTransport(({ service }) => {
    service(Pipelines, {
      extractClaims: (request) => mockExtractClaims(request),
    });
  });

const documentPublished = (
  overrides: Partial<LedgerDocumentPublishedMessage> = {},
) =>
  new LedgerDocumentPublishedMessage({
    documentId: 'ygg-doc-1',
    sourceId: 'vendor-changelog-1',
    url: 'https://vendor.dev/changelog/?utm_source=rss',
    title: 'Vendor changelog',
    sourceName: 'Vendor Changelog',
    sourceClass: LedgerSourceClass.VENDOR_CHANGELOG,
    publishedAt: BigInt(Date.UTC(2026, 2, 11) / 1000),
    contentLocation: 'gs://daily-dev-ledger-documents/vendor/4.2.0.md',
    contentFormat: LedgerContentFormat.MARKDOWN,
    contentHash: 'hash-1',
    ...overrides,
  });

const extracted = (statement: string) =>
  new ExtractClaimsResponse({
    id: 'op-1',
    model: 'test',
    claims: [
      new ProtoClaim({
        entityName: 'vendor-sdk',
        entityKind: ProtoClaimEntityKind.PACKAGE,
        changeType: ProtoClaimChangeType.REMOVAL,
        statement,
        effectiveDate: '2026-03',
        directness: ProtoClaimDirectness.ANNOUNCEMENT,
        evidence: 'The legacy `render` export is removed.',
        affected: ['renderLegacyTree', 'name'],
      }),
    ],
  });

const removal = 'Vendor SDK 4.2.0 removes the legacy render export.';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await saveFixtures(con, Source, sourcesFixture);

  const mockBucket = {
    file: jest.fn().mockReturnValue({ download: mockDownload }),
  };
  (Storage as unknown as jest.Mock).mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue(mockBucket),
  }));
  mockDownload.mockResolvedValue([Buffer.from(notes)]);

  jest
    .spyOn(bragiClients, 'getBragiClient')
    .mockImplementation((): ServiceClient<typeof Pipelines> => {
      return {
        instance: createClient(Pipelines, createTransport()),
        garmr: createGarmrMock(),
      };
    });
  mockExtractClaims.mockResolvedValue(
    new ExtractClaimsResponse({ id: 'op-1', model: 'test', claims: [] }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('extractLedgerDocumentClaims worker', () => {
  it('should be registered', () => {
    expect(
      typedWorkers.find((item) => item.subscription === worker.subscription),
    ).toBeDefined();
  });

  it('should file the document and its claims without a post', async () => {
    mockExtractClaims.mockResolvedValue(extracted(removal));

    await expectSuccessfulTypedBackground<'yggdrasil.v1.ledger-document-published'>(
      worker,
      documentPublished(),
    );

    // Keyed by the id yggdrasil sent, holding the canonical url.
    const document = await con
      .getRepository(LedgerDocument)
      .findOneByOrFail({ id: 'ygg-doc-1' });
    expect(document).toMatchObject({
      url: 'https://vendor.dev/changelog',
      sourceId: 'vendor-changelog-1',
      title: 'Vendor changelog',
      sourceName: 'Vendor Changelog',
      sourceClass: ClaimEvidenceSourceClass.VendorChangelog,
      contentFormat: LedgerDocumentFormat.Markdown,
      contentHash: 'hash-1',
      publishedAt: new Date('2026-03-11T00:00:00.000Z'),
    });
    expect(document.extractedAt).not.toBeNull();

    expect(mockExtractClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: document.id,
        title: 'Vendor changelog',
        contentFormat: ContentFormat.Markdown,
        content: notes,
        url: 'https://vendor.dev/changelog',
        source: 'Vendor Changelog',
        publishedDate: '2026-03-11',
      }),
    );

    const candidates = await con.getRepository(ClaimCandidate).find();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      postId: null,
      documentId: document.id,
      rawEntityName: 'vendor-sdk',
      entityKind: LedgerEntityKind.Package,
      changeType: ClaimChangeType.Removal,
      effectiveDate: '2026-03-01',
      directness: ClaimDirectness.Announcement,
      // "name" falls below the specificity bar the shared core enforces.
      affected: ['renderLegacyTree'],
    });
  });

  it('should stamp a document that yielded no claims so redelivery costs nothing', async () => {
    await expectSuccessfulTypedBackground<'yggdrasil.v1.ledger-document-published'>(
      worker,
      documentPublished(),
    );
    await expectSuccessfulTypedBackground<'yggdrasil.v1.ledger-document-published'>(
      worker,
      documentPublished(),
    );

    expect(mockExtractClaims).toHaveBeenCalledTimes(1);
    expect(await con.getRepository(LedgerDocument).count()).toEqual(1);
  });

  it('should re-extract a rolling page once its content changes', async () => {
    mockExtractClaims.mockResolvedValue(extracted(removal));
    await expectSuccessfulTypedBackground<'yggdrasil.v1.ledger-document-published'>(
      worker,
      documentPublished(),
    );

    mockExtractClaims.mockResolvedValue(
      new ExtractClaimsResponse({
        id: 'op-2',
        model: 'test',
        claims: [
          ...extracted(removal).claims,
          new ProtoClaim({
            entityName: 'vendor-sdk',
            entityKind: ProtoClaimEntityKind.PACKAGE,
            changeType: ProtoClaimChangeType.DEPRECATION,
            statement: 'Vendor SDK 4.3.0 deprecates the config file.',
            directness: ProtoClaimDirectness.ANNOUNCEMENT,
            evidence: 'The config file is deprecated.',
          }),
        ],
      }),
    );
    await expectSuccessfulTypedBackground<'yggdrasil.v1.ledger-document-published'>(
      worker,
      documentPublished({ contentHash: 'hash-2' }),
    );

    expect(mockExtractClaims).toHaveBeenCalledTimes(2);
    // The entry it already saw is not filed twice, the new one is.
    expect(
      (await con.getRepository(ClaimCandidate).find())
        .map(({ statement }) => statement)
        .sort(),
    ).toEqual([removal, 'Vendor SDK 4.3.0 deprecates the config file.']);
  });

  it('should stand down when the post lane already covered the url', async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'ldp1',
        shortId: 'ldp1',
        sourceId: 'a',
        title: 'Vendor changelog',
        url: 'https://vendor.dev/changelog',
        canonicalUrl: 'https://vendor.dev/changelog',
      },
    ]);
    await con.getRepository(ClaimCandidate).save({
      postId: 'ldp1',
      rawEntityName: 'vendor-sdk',
      entityKind: LedgerEntityKind.Package,
      changeType: ClaimChangeType.Removal,
      statement: removal,
      directness: ClaimDirectness.Announcement,
      evidence: 'The legacy `render` export is removed.',
    });

    await expectSuccessfulTypedBackground<'yggdrasil.v1.ledger-document-published'>(
      worker,
      documentPublished(),
    );

    expect(mockExtractClaims).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
    // Stamped anyway, so the lookup does not repeat on every redelivery.
    const document = await con
      .getRepository(LedgerDocument)
      .findOneByOrFail({ id: 'ygg-doc-1' });
    expect(document.extractedAt).not.toBeNull();
    expect(await con.getRepository(ClaimCandidate).count()).toEqual(1);
  });
});
