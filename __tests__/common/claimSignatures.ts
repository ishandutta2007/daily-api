import { extractClaimSignatures } from '../../src/common/claimSignatures';
import { AnthropicClient } from '../../src/integrations/anthropic';
import { ClaimChangeType } from '../../src/entity/claim/Claim';

const statement =
  'Django 6.0 changed the default URL scheme of forms.URLField and removed the FORMS_URLFIELD_ASSUME_HTTPS setting.';

const clientReturning = (input: Record<string, unknown>): AnthropicClient =>
  ({
    createMessage: async () => ({ content: [{ input }] }),
  }) as unknown as AnthropicClient;

const run = (
  input: Record<string, unknown>,
  statementText = statement,
  proseEntityNames?: Set<string>,
) =>
  extractClaimSignatures({
    client: clientReturning(input),
    model: 'test-model',
    claim: { statement: statementText, changeType: ClaimChangeType.Breaking },
    entityName: 'Django',
    entityAliases: ['django', 'Django Framework'],
    proseEntityNames,
  });

const nextStatement =
  'In Next.js 16 the images.domains option for next/image is deprecated in favor of images.remotePatterns.';

// The own-entity bar needs the entity's code-only aliases: `next` is one on
// Next.js, and `next/image` is its module path however the token arrived.
const runNext = (input: Record<string, unknown>) =>
  extractClaimSignatures({
    client: clientReturning(input),
    model: 'test-model',
    claim: {
      statement: nextStatement,
      changeType: ClaimChangeType.Deprecation,
    },
    entityName: 'Next.js',
    entityAliases: ['nextjs'],
    entityCodeOnlyAliases: ['next'],
  });

describe('extractClaimSignatures', () => {
  it('should keep the tokens the statement actually contains', async () => {
    await expect(
      run({
        affected: ['forms.URLField', 'FORMS_URLFIELD_ASSUME_HTTPS'],
        superseding: [],
      }),
    ).resolves.toEqual({
      affected: ['forms.URLField', 'FORMS_URLFIELD_ASSUME_HTTPS'],
      superseding: [],
    });
  });

  it('should drop a token the statement never names', async () => {
    // The failure that turns a signature into a false accusation against
    // working code: matching is by equality, so an invented token accuses a
    // reader who never wrote it.
    await expect(
      run({
        affected: ['forms.URLField', 'forms.EmailField'],
        superseding: [],
      }),
    ).resolves.toMatchObject({ affected: ['forms.URLField'] });
  });

  it('should drop a CVE identifier, which names an advisory rather than anything in the code', async () => {
    await expect(
      run(
        { affected: ['CVE-2025-59156', 'forms.URLField'], superseding: [] },
        'CVE-2025-59156 affects forms.URLField in Django.',
      ),
    ).resolves.toMatchObject({ affected: ['forms.URLField'] });
  });

  it('should drop a token that only repeats the entity it is filed against', async () => {
    // Matches every plan mentioning the technology rather than the change.
    await expect(
      run(
        { affected: ['Django Framework', 'forms.URLField'], superseding: [] },
        'Django Framework changed forms.URLField.',
      ),
    ).resolves.toMatchObject({ affected: ['forms.URLField'] });
  });

  it('should drop a token claimed on both sides at once', async () => {
    // It cannot be both the stale choice and the current one, and half of the
    // pair would flag a reader for doing the right thing.
    await expect(
      run(
        { affected: ['#klass', 'forms.URLField'], superseding: ['#klass'] },
        'The #klass helper and forms.URLField both changed.',
      ),
    ).resolves.toEqual({ affected: ['forms.URLField'], superseding: [] });
  });

  it('should drop a token too generic to identify the API on its own', async () => {
    // The specificity bar (smith-brain/docs/claim-ledger-review-playbook.md
    // §13, v5.9): matching is exact-equality, so `affected: ["name"]` accuses
    // every codebase on earth — the 2026-08-20 backfill shipped exactly that
    // and rot-bench's harness pilot got 15 identical tier-A false findings on
    // an unrelated diff.
    await expect(
      run(
        {
          affected: ['name', 'GET', 'user.name', 'forms.URLField'],
          superseding: ['application/json'],
        },
        'GET requests with a name or user.name of application/json break forms.URLField.',
      ),
    ).resolves.toEqual({ affected: ['forms.URLField'], superseding: [] });
  });

  it('should keep a bare package name, which the detector gates at match time instead', async () => {
    await expect(
      run(
        { affected: ['axios'], superseding: [] },
        'A typosquat of axios steals credentials on install.',
      ),
    ).resolves.toEqual({ affected: ['axios'], superseding: [] });
  });

  it('should survive a response that carries no usable input', async () => {
    await expect(run({})).resolves.toEqual({ affected: [], superseding: [] });
    await expect(
      run({ affected: 'not-an-array', superseding: [42, '', '   '] }),
    ).resolves.toEqual({ affected: [], superseding: [] });
  });

  it('should drop a multi-word technology name while keeping a single-word one', async () => {
    // "Django REST Framework" cannot be a lexical token, so a plan containing
    // it is describing the technology in prose. "celery" is what a
    // requirements.txt pins, so it stays and the detector gates the match.
    await expect(
      run(
        {
          affected: ['Django REST Framework', 'celery', 'forms.URLField'],
          superseding: [],
        },
        'Django 6.0 dropped Django REST Framework and celery support alongside the forms.URLField change.',
        new Set(['djangorestframework', 'celery']),
      ),
    ).resolves.toMatchObject({ affected: ['celery', 'forms.URLField'] });
  });

  it('should drop a module path inside the entity own package beside a real symbol', async () => {
    // Playbook §13 v5.21 / rot-bench rule 1b: `next/image` names Next.js, and
    // the entity field already says that. `{images.domains, next/image}` is
    // the array that fired tier-A on six reps which imported the module and
    // configured no images at all.
    await expect(
      runNext({
        affected: ['images.domains', 'next/image'],
        superseding: ['images.remotePatterns'],
      }),
    ).resolves.toEqual({
      affected: ['images.domains'],
      superseding: ['images.remotePatterns'],
    });
  });

  it('should empty an array holding nothing but the entity own names', async () => {
    // No subject-level carve-out on this side. The prompt says "never the
    // entity's own name"; an extractor that returns only that has disobeyed
    // it, and the claim still reaches a relevant diff through its entity.
    await expect(
      runNext({ affected: ['next/image', 'Next.js'], superseding: [] }),
    ).resolves.toEqual({ affected: [], superseding: [] });
  });
});
