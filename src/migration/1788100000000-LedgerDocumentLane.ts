import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LedgerDocumentLane1788100000000 implements MigrationInterface {
  name = 'LedgerDocumentLane1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(/* sql */ `
      CREATE TABLE IF NOT EXISTS "ledger_document" (
        "id" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "sourceId" text NOT NULL,
        "url" text NOT NULL,
        "title" text NOT NULL,
        "sourceName" text NOT NULL,
        "sourceClass" text NOT NULL,
        "publishedAt" TIMESTAMP,
        "contentLocation" text NOT NULL,
        "contentFormat" text NOT NULL,
        "contentHash" text NOT NULL,
        "extractedAt" TIMESTAMP,
        CONSTRAINT "PK_ledger_document_id" PRIMARY KEY ("id")
      )
    `);

    // Not unique: the id is the identity, so a re-poll of one url under a new
    // document id has to be an insert rather than a constraint violation.
    await queryRunner.query(/* sql */ `
      CREATE INDEX IF NOT EXISTS "IDX_ledger_document_url"
        ON "ledger_document" ("url")
    `);

    await queryRunner.query(/* sql */ `
      CREATE INDEX IF NOT EXISTS "IDX_ledger_document_sourceId"
        ON "ledger_document" ("sourceId")
    `);

    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_candidate"
        ADD COLUMN IF NOT EXISTS "documentId" text
    `);

    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_candidate"
        ALTER COLUMN "postId" DROP NOT NULL
    `);

    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_candidate"
        ADD CONSTRAINT "FK_claim_candidate_document_id"
        FOREIGN KEY ("documentId")
        REFERENCES "ledger_document"("id")
        ON DELETE CASCADE
        ON UPDATE NO ACTION
    `);

    // The document half of the dedupe "IDX_claim_candidate_postId_statement_
    // unique" enforces for posts. Separate rather than one index over both
    // columns, because a null never equals a null in a btree. md5 because a
    // statement can exceed the btree tuple limit.
    await queryRunner.query(/* sql */ `
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_claim_candidate_documentId_statement_unique"
        ON "claim_candidate" ("documentId", md5("statement"))
        WHERE "documentId" IS NOT NULL
    `);

    // Stays null alongside a null postId for a reviewer's manual citation.
    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_evidence"
        ADD COLUMN IF NOT EXISTS "documentId" text
    `);

    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_evidence"
        ADD CONSTRAINT "FK_claim_evidence_document_id"
        FOREIGN KEY ("documentId")
        REFERENCES "ledger_document"("id")
        ON DELETE SET NULL
        ON UPDATE NO ACTION
    `);

    await queryRunner.query(/* sql */ `
      CREATE INDEX IF NOT EXISTS "IDX_claim_evidence_documentId"
        ON "claim_evidence" ("documentId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_evidence"
        DROP COLUMN IF EXISTS "documentId"
    `);

    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_candidate"
        DROP COLUMN IF EXISTS "documentId"
    `);

    // Destructive: a document-backed candidate has no post to fall back to,
    // and postId cannot be made NOT NULL while one exists.
    await queryRunner.query(/* sql */ `
      DELETE FROM "claim_candidate" WHERE "postId" IS NULL
    `);

    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim_candidate"
        ALTER COLUMN "postId" SET NOT NULL
    `);

    await queryRunner.query(/* sql */ `
      DROP TABLE IF EXISTS "ledger_document"
    `);
  }
}
