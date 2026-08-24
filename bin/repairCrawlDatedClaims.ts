import '../src/config';
import createOrGetConnection from '../src/db';
import {
  planCrawlDateRepairs,
  repairCrawlDatedClaims,
} from '../src/common/ledgerHygiene';

// Re-dates claims that were dated from the day we CRAWLED the post, on posts
// whose real publication date is now known. See `planCrawlDateRepairs` for what
// it will and will not touch — in particular it invents nothing, so it can only
// reach as far as the post rows have been repaired. Run it AFTER the posts.
//
// Idempotent: a repaired claim carries `evidence_published` and is out of scope
// on the next run.
(async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  const con = await createOrGetConnection();

  if (dryRun) {
    const groups = await planCrawlDateRepairs(con);
    const claims = [...groups.values()].reduce(
      (sum, ids) => sum + ids.length,
      0,
    );

    console.log(`${claims} claims to re-date across ${groups.size} dates`);
    console.table(
      [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 20)
        .map(([effectiveDate, ids]) => ({ effectiveDate, claims: ids.length })),
    );
    process.exit(0);
  }

  console.log(`${await repairCrawlDatedClaims(con)} claims re-dated`);
  process.exit(0);
})();
