import { isSignatureWithheld } from '../../src/common/signatureWithheld';

describe('isSignatureWithheld', () => {
  it('should be true when the bar took every token the claim proposed', () => {
    // The whole point: the claim HAS a code surface, and none of the strings
    // that expressed it may be matched on. `a1203b23` is this row —
    // `{merge}` on a Zod 4 deprecation, refused as one ordinary word.
    expect(isSignatureWithheld({ proposed: ['merge'], kept: [] })).toBe(true);
    expect(isSignatureWithheld({ proposed: ['name', 'GET'], kept: [] })).toBe(
      true,
    );
  });

  it('should be false when the claim proposed nothing at all', () => {
    // A claim with no code surface is the OTHER meaning of an empty array, and
    // it is the one a version pin is legitimately evidence for. Marking it
    // would delete tier B from every version-line claim in the ledger.
    expect(isSignatureWithheld({ proposed: [], kept: [] })).toBe(false);
  });

  it('should be false while any token survived', () => {
    // A surviving token makes the claim symbol-level by the array itself, so
    // the flag has nothing to add and a partial refusal is not a withholding.
    expect(
      isSignatureWithheld({
        proposed: ['name', 'forms.URLField'],
        kept: ['forms.URLField'],
      }),
    ).toBe(false);
  });
});
