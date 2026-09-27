# Demo: Plan 1 M1, note model and round trip

```bash
cd packages/okf
npx vitest run test/roundtrip.test.ts src/lifecycle.test.ts
```

- The property tests generate frontmatter with comments, unknown keys, nested maps, flow and
  block styles, and unicode, and check that an unmodified note serializes byte-identically and
  that changing one key changes only that key's lines.
- Every note in `fixtures/vault-acme` round-trips, and bumping `version` changes exactly one line.
- Try it by hand:

```bash
node -e 'import("./src/index.ts").then(({parseNote, serializeNote}) => {
  const n = parseNote("---\ntype: How-To # keep me\ntitle: T\ncustom: {a: 1}\n---\nBody\n", "kb/x/y.md");
  n.data.version = "1.0.0"; n.data.themes = ["enrollment"];
  console.log(serializeNote(n));
})'
```
