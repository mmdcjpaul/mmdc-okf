# Demo: Plan 1 M5, chunker

```bash
cd packages/okf && npx vitest run test/chunk.test.ts
ls test/golden/chunks                              # golden chunks for 10 fixture notes
```

Each chunk has an id `<noteId>#<position>`, a heading path, a deterministic contextual header
(title, type, namespace, summary, themes, systems, section), the exact body slice, a token
count (js-tiktoken cl100k), and a sha256 content hash. Property tests check that chunks cover
the body exactly once, stay within 700 tokens unless a chunk is one indivisible block, and are
deterministic.
