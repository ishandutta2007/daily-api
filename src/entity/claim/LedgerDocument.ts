import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { ClaimEvidenceSourceClass } from './ClaimEvidence';

export enum LedgerDocumentFormat {
  Xml = 'xml',
  Markdown = 'markdown',
  Html = 'html',
}

// A document scraped only for claim extraction — vendor changelogs, release
// notes, security advisories — which never becomes a post.
@Entity()
// Not unique: the id is the identity, so a re-poll of one url under a new
// document id has to be an insert rather than a constraint violation.
@Index('IDX_ledger_document_url', ['url'])
@Index('IDX_ledger_document_sourceId', ['sourceId'])
export class LedgerDocument {
  // Yggdrasil's own id, used verbatim.
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'PK_ledger_document_id',
  })
  id: string;

  @Column({ default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'text' })
  sourceId: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  sourceName: string;

  @Column({ type: 'text' })
  sourceClass: ClaimEvidenceSourceClass;

  // Null means the source stated no date, which a claim's date provenance
  // grades differently from a date it actually carries.
  @Column({ type: 'timestamp', nullable: true, default: null })
  publishedAt: Date | null;

  @Column({ type: 'text' })
  contentLocation: string;

  @Column({ type: 'text' })
  contentFormat: LedgerDocumentFormat;

  // A rolling release-notes page keeps one document while gaining entries, so
  // a changed hash reopens it for extraction.
  @Column({ type: 'text' })
  contentHash: string;

  // A timestamp rather than "does any candidate exist", so a document that
  // yields zero claims is not re-extracted on every redelivery.
  @Column({ type: 'timestamp', nullable: true, default: null })
  extractedAt: Date | null;
}
