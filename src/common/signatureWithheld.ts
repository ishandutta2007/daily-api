// The withheld-signature fact — playbook §13 v5.22, and the emission half of
// rot-bench detector 0.14.0's grain rule.
//
// WHAT THIS GUARANTEES. A claim whose `affected` array is empty because the
// emission bar refused every token it proposed is marked `signatureWithheld`,
// so a reader can tell it apart from a claim whose array is empty because the
// claim has no code surface at all.
//
// WHY IT HAS TO EXIST. The two look identical in the row and mean opposite
// things. rot-bench reads an empty `affected` as "this claim's subject is the
// VERSION LINE", which is the only shape a version pin is evidence for, and
// grants it tier B on any project pinned inside the scope (detector 0.9.0).
// `a1203b23` — "Zod 4 deprecated `.merge()` on object schemas" — is
// symbol-level: its subject is `merge`, one generic word, which §13 refuses
// because an exact-equality match on `merge` accuses every codebase on earth.
// The refusal is right. What was wrong is that the claim then READ as a
// statement about the whole Zod 4 line and earned tier B on every zod pin: six
// Tier-2 reps, six findings, all judged false.
//
// So the bar keeps refusing the token, and records that it refused. The claim
// is not silenced — it still fires through its entity, at the detector's
// exposure tier — it simply never again passes for a claim about a version.
//
// SCOPE, and it is deliberate: `affected` ONLY. `signatureWithheld` answers
// one question — "is this claim symbol-level?" — and `affected` is the array
// that answers it. A claim whose `affected` survived is symbol-level by the
// array itself and needs no flag; a claim whose `superseding` was refused has
// lost a suppression, which is a recall cost with no bearing on grain.
//
// PROPOSED, and it is deliberate too: only a token the claim's own STATEMENT
// contains was ever this claim's signature. An extractor that invents
// `forms.EmailField` for a statement that never says it has not proposed a
// signature the bar then refused — it has hallucinated, and grounding is a
// separate rule with a separate name. So the extraction path counts its
// GROUNDED tokens as the proposal; the reviewer routes count what the operator
// wrote, because an operator typing a token into `/claims/update` has proposed
// it by definition.

// PURE. Did the bar take everything the claim offered?
export const isSignatureWithheld = ({
  proposed,
  kept,
}: {
  proposed: readonly string[];
  kept: readonly string[];
}): boolean => proposed.length > 0 && kept.length === 0;
