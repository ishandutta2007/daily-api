import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ClaimSignatureWithheld1788000000000 implements MigrationInterface {
  name = 'ClaimSignatureWithheld1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // An empty `affected` means two opposite things and the row cannot say
    // which: the claim has no code surface (its subject is the version line),
    // or it has one and the §13 specificity bar refused every token that
    // expressed it. rot-bench reads the first meaning and grants such a claim
    // tier B from a version pin alone, so a claim of the second kind reads as
    // a statement about a whole major and fires on every project pinned to it.
    //
    // Defaulted false rather than null: a claim nobody has measured has not
    // withheld anything, and a nullable tri-state would put "unknown" into a
    // rule whose whole purpose is to REMOVE a tier. Unknown must behave like
    // today, which is false.
    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim"
        ADD COLUMN IF NOT EXISTS "signatureWithheld" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(/* sql */ `
      ALTER TABLE "claim"
        DROP COLUMN IF EXISTS "signatureWithheld"
    `);
  }
}
