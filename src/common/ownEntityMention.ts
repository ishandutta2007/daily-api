// Own-entity mentions in a signature array — the emission half of rot-bench
// detector 0.13.0's signature-gate rule 1b, and playbook §13's v5.21
// amendment.
//
// WHAT THIS GUARANTEES. A token in `affected`/`superseding` that names the
// claim's OWN entity — its canonical name, an alias, a code-only alias, or a
// module path inside a package of one of those names — is not written to the
// ledger when the same array holds another token. Naming a product puts the
// product in view, which is the entity route's job and the entity route's
// tier; it says nothing about WHICH of the product's changes the input
// touched, which is the only thing a signature array exists to say.
//
// `{images.domains, next/image}` is the shape, on a Next.js claim about the
// `images.domains` config option: six greenfield reps wrote
// `import Image from 'next/image'`, configured no images at all, and read a
// tier-A finding. The detector refuses that match since 0.13.0; this refuses
// the array that makes it possible, which is where the bar belongs — the
// detector's own README calls the code half "defence-in-depth under a bar
// that belongs where the arrays are written" (known gap 24).
//
// THE ONE CASE THIS DOES NOT TOUCH, and it needs a human rather than a rule.
// When NOTHING would survive the strip — the mention is the array's only
// token, or every token in it is one — the claim is about the module AS A
// WHOLE. `0ded4c9b`, "a local `src` containing a query string needs
// `images.localPatterns`", carries `{next/image}` and nothing else because its
// subject is a usage pattern no token captures; `3b42995a` carries
// `{@ionic/angular/lazy, @ionic/angular/standalone}` and is about the two
// entry points themselves. There the array is not wrong; it is simply not a
// signature, and the ledger has no field that says so today.
// `keepWhenNoSurvivor` is that carve-out, and it is granted only to the
// reviewer routes: a person writing a module path by hand is making the
// subject-level call deliberately, and extraction cannot make it at all — an
// extractor that returns only the product's own name has failed the prompt it
// was given ("never the entity's own name"), so nothing there is worth
// keeping.
//
// SCOPE, stated. Both polarities. The detector applies rule 1b to `affected`
// only, because suppression conjures no finding and its rules all answer
// "may this string CONJURE one" — but emission is not matching: §13 has said
// "never the entity name" about both arrays since v5.9, and a `superseding`
// token that merely names the product suppresses every reader who imports
// the package rather than every reader who made the current choice.

import { normalizeSignatureToken } from './ledgerEntityNames';

// PURE. The package a specifier belongs to: itself, when it is not a subpath.
// `next/image` → `next`, `@scope/pkg/sub` → `@scope/pkg`, `next` → `next`.
// Kept identical to rot-bench's src/detector/packageSpecifier.ts, which is the
// copy the match-time rule reads; if one changes the other has to change with
// it or the gate and the bar can disagree about what `@scope/pkg/sub` belongs
// to.
export const packageRootOf = (spec: string): string => {
  const parts = spec.split('/');

  return spec.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : (parts[0] ?? spec);
};

// The names one entity answers to, in the two spellings the two halves of the
// rule need.
//
// `literal` is trim+lowercase and nothing else, because the subpath half
// compares a PATH ROOT and a path root is a literal string: `next/image` is a
// module of `next` and of nothing else. `loose` drops punctuation as every
// other signature comparison in this file's neighbourhood does, because the
// whole-token half is asking "is this string the product's name", and a
// statement writing `Node.js` and a plan writing `nodejs` mean the same one.
export type OwnEntityNames = {
  literal: ReadonlySet<string>;
  loose: ReadonlySet<string>;
};

export const ownEntityNames = (entity: {
  canonicalName: string;
  aliases?: string[] | null;
  codeOnlyAliases?: string[] | null;
}): OwnEntityNames => {
  // `codeOnlyAliases` are included and `codeOnlyCanonical` is ignored, both
  // deliberately: those flags gate ENTITY RESOLUTION — whether a name in
  // prose may summon the entity — and this rule is not asking what the token
  // resolved. `next` is a code-only alias of Next.js, and `next/image` is
  // still Next.js's own module path however the token arrived.
  const names = [
    entity.canonicalName,
    ...(entity.aliases ?? []),
    ...(entity.codeOnlyAliases ?? []),
  ].filter((name) => !!name?.trim());
  const literal = new Set<string>();
  const loose = new Set<string>();

  names.forEach((name) => {
    literal.add(name.trim().toLowerCase());
    const normalized = normalizeSignatureToken(name);
    // Two characters cannot identify anything on its own and the specificity
    // bar already refuses such a token on its own terms, so admitting one here
    // would only let a one-letter alias eat an unrelated signature.
    if (normalized.length > 2) {
      loose.add(normalized);
    }
  });

  return { literal, loose };
};

// PURE. Is this token a mention of the entity it is filed against?
export const isOwnEntityMention = (
  token: string,
  names: OwnEntityNames,
): boolean => {
  const normalized = normalizeSignatureToken(token);
  if (normalized.length > 2 && names.loose.has(normalized)) {
    return true;
  }

  const literal = token.trim().toLowerCase();
  const root = packageRootOf(literal);
  // A path under a HOST is not a module of a package. An entity aliased to
  // `generativelanguage.vendorai.com` keeps its signature on
  // `generativelanguage.vendorai.com/api/v1`, because the operator chose that
  // path to name one endpoint. rot-bench asks the Public Suffix List; a dot in
  // the root is the same question asked without shipping the list, and it errs
  // the safe way — it only ever KEEPS a token this rule would otherwise drop.
  if (root === literal || root.includes('.')) {
    return false;
  }

  return names.literal.has(root);
};

// The array policy. Own-entity mentions go, unless nothing at all would be
// left and the caller is a reviewer route (see the header's carve-out).
export const withoutOwnEntityMentions = ({
  tokens,
  names,
  keepWhenNoSurvivor = false,
}: {
  tokens: string[];
  names: OwnEntityNames;
  keepWhenNoSurvivor?: boolean;
}): string[] => {
  const kept = tokens.filter((token) => !isOwnEntityMention(token, names));

  return keepWhenNoSurvivor && !kept.length ? tokens : kept;
};
