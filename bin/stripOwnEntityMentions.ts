import '../src/config';
import createOrGetConnection from '../src/db';
import type { DataSource } from 'typeorm';
import { Claim } from '../src/entity/claim/Claim';
import { LedgerEntity } from '../src/entity/claim/LedgerEntity';
import {
  ownEntityNames,
  withoutOwnEntityMentions,
} from '../src/common/ownEntityMention';

// The one-shot pass that brings the arrays already in the ledger up to the bar
// the write paths now apply (playbook §13 v5.21, rot-bench known gap 24).
//
// Who qualifies is NOT decided here — `src/common/ownEntityMention.ts` is the
// rule, and this script only walks the rows and prints what it did. That is
// `bin/backfillClaimDates.ts`'s recorded mistake, avoided: a backfill holding
// its own copy of a rule is a backfill that will fight the route over the same
// rows every time one of them changes.
//
// TWO POPULATIONS, and only one of them is this script's business:
//
//   - **strippable** — the array holds an own-entity mention AND at least one
//     token that is not one. The mention costs the claim its precision and the
//     survivor still says what changed, so it goes.
//   - **no survivor** — every token in the array is an own-entity mention
//     (`{next/image}`, `{@ionic/angular/lazy, @ionic/angular/standalone}`).
//     The claim is about the module AS A WHOLE and the array is not wrong, it
//     is simply not a signature. Emptying it would delete the only thing the
//     claim says, so these are LISTED FOR REVIEW and never written. There is no
//     flag to make this script strip them; that decision needs a person.
//
// Idempotent: a stripped array holds no own-entity mention, so the next run
// does not select it. `--dry-run` writes nothing and prints the same counts
// plus a sample, which is the pass a reviewer reads before the real one.
//
//   pnpm ts-node bin/stripOwnEntityMentions.ts --dry-run [--sample=20]
//   pnpm ts-node bin/stripOwnEntityMentions.ts

type Row = {
  id: string;
  entityId: string;
  entityName: string;
  entityKind: string;
  status: string;
  affected: string[];
  superseding: string[];
  canonicalName: string;
  aliases: string[];
  codeOnlyAliases: string[];
};

type Plan = {
  claimId: string;
  entityName: string;
  entityKind: string;
  status: string;
  side: 'affected' | 'superseding';
  before: string[];
  after: string[];
  removed: string[];
  verdict: 'strip' | 'no-survivor';
};

const arg = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1];

// Every claim carrying any signature token, with the names of the entity it is
// filed against. The rule is not expressible in SQL without a second copy of
// it, so the filtering happens in TypeScript against the one home; the ledger
// is small enough (tens of thousands of rows) that reading the arrays costs
// less than maintaining that copy would.
export const planOwnEntityStrip = async (con: DataSource): Promise<Plan[]> => {
  const rows = await con
    .getRepository(Claim)
    .createQueryBuilder('c')
    .innerJoin(LedgerEntity, 'le', 'le.id = c."entityId"')
    .select('c.id', 'id')
    .addSelect('c."entityId"', 'entityId')
    .addSelect('c.affected', 'affected')
    .addSelect('c.superseding', 'superseding')
    .addSelect('c.status', 'status')
    .addSelect('le."canonicalName"', 'entityName')
    .addSelect('le."canonicalName"', 'canonicalName')
    .addSelect('le.kind', 'entityKind')
    .addSelect('le.aliases', 'aliases')
    .addSelect('le."codeOnlyAliases"', 'codeOnlyAliases')
    .where('cardinality(c.affected) > 0 OR cardinality(c.superseding) > 0')
    .orderBy('c.id', 'ASC')
    .getRawMany<Row>();

  const plans: Plan[] = [];

  rows.forEach((row) => {
    const names = ownEntityNames(row);

    (['affected', 'superseding'] as const).forEach((side) => {
      const before = row[side] ?? [];
      if (!before.length) {
        return;
      }

      const after = withoutOwnEntityMentions({ tokens: before, names });
      if (after.length === before.length) {
        return;
      }

      plans.push({
        claimId: row.id,
        entityName: row.entityName,
        entityKind: row.entityKind,
        status: row.status,
        side,
        before,
        after,
        removed: before.filter((token) => !after.includes(token)),
        verdict: after.length ? 'strip' : 'no-survivor',
      });
    });
  });

  return plans;
};

const counts = (plans: Plan[], key: keyof Plan): { k: string; n: number }[] => {
  const tally = new Map<string, number>();
  plans.forEach((plan) =>
    tally.set(String(plan[key]), (tally.get(String(plan[key])) ?? 0) + 1),
  );

  return [...tally.entries()]
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n);
};

const report = (plans: Plan[]): void => {
  const strip = plans.filter(({ verdict }) => verdict === 'strip');
  const review = plans.filter(({ verdict }) => verdict === 'no-survivor');

  console.log(
    `${strip.length} arrays strippable (${strip.reduce(
      (sum, { removed }) => sum + removed.length,
      0,
    )} tokens) across ${new Set(strip.map(({ claimId }) => claimId)).size} claims`,
  );
  console.table(
    counts(strip, 'side').map(({ k, n }) => ({ side: k, arrays: n })),
  );
  console.table(
    counts(strip, 'entityKind').map(({ k, n }) => ({
      entityKind: k,
      arrays: n,
    })),
  );
  console.log(
    `${review.length} arrays left for review: every token is an own-entity mention`,
  );
};

(async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  const sample = parseInt(arg('sample') ?? '20', 10);
  const con = await createOrGetConnection();
  const plans = await planOwnEntityStrip(con);
  const strip = plans.filter(({ verdict }) => verdict === 'strip');

  report(plans);

  if (dryRun) {
    // A sample, because a count cannot show a systematic error and reading
    // twenty rows can — the same reason bin/backfillClaimCorroboration.ts
    // prints one.
    console.log(`\nsample of ${sample} strips:`);
    console.table(
      strip
        .slice(0, sample)
        .map(({ claimId, entityName, side, before, after }) => ({
          claimId: claimId.slice(0, 8),
          entity: entityName,
          side,
          before: before.join(', ').slice(0, 60),
          after: after.join(', ').slice(0, 60),
        })),
    );
    console.log('\nleft for review (no survivor):');
    console.table(
      plans
        .filter(({ verdict }) => verdict === 'no-survivor')
        .map(({ claimId, entityName, side, before }) => ({
          claimId: claimId.slice(0, 8),
          entity: entityName,
          side,
          tokens: before.join(', ').slice(0, 60),
        })),
    );
    process.exit(0);
  }

  // One update per array rather than one per claim: a claim can be strippable
  // on both sides, and writing each side as it was planned keeps the printed
  // before/after and the row that lands identical.
  for (const plan of strip) {
    await con
      .getRepository(Claim)
      .update({ id: plan.claimId }, { [plan.side]: plan.after });
    console.log(
      `${plan.claimId} ${plan.side}: [${plan.before.join(', ')}] -> [${plan.after.join(', ')}]`,
    );
  }

  console.log(`done: ${strip.length} arrays written`);
  process.exit(0);
})();
