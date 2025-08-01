import '../src/config';
import createOrGetConnection from '../src/db';

(async (): Promise<void> => {
  const limitArgument = process.argv[2];
  const offsetArgument = process.argv[3];

  const limit = limitArgument ? +limitArgument : 1000;
  const offset = offsetArgument ? +offsetArgument : 0;

  if (Number.isNaN(limit)) {
    throw new Error('limit argument is invalid, it should be a number');
  }

  if (Number.isNaN(offset)) {
    throw new Error('offset argument is invalid, it should be a number');
  }

  const con = await createOrGetConnection();

  console.log(
    `Syncing members count for sources with limit: ${limit}, offset: ${offset}`,
  );

  await con.transaction(async (manager) => {
    const result = await manager.query(`
      UPDATE source
      SET flags = jsonb_set(
        COALESCE(flags, '{}'),
        '{totalMembers}',
        to_jsonb((
          SELECT COUNT(DISTINCT cp."userId")
          FROM content_preference cp
          WHERE cp."referenceId" = source.id
          AND cp.type = 'source'
          AND cp.status IN ('follow', 'subscribed')
        ))
      )
      WHERE source.id IN (
        SELECT id FROM source
        ORDER BY "createdAt" ASC
        LIMIT ${limit} OFFSET ${offset}
      )
    `);

    console.log(`Updated ${result[1]} sources`);
  });

  process.exit();
})();
