# 0002: A compact cached index for `kb query` instead of MiniSearch

- Status: Accepted
- Date: 2026-09-24
- Plan: 1, milestone M6

## Context

Plan 1 specifies `kb query` as MiniSearch over title, aliases, description, and body, cached in
`.kb/.cache/` and keyed by file mtimes, answering in under 200 ms on the 20,000-note synthetic
vault once the cache is warm.

Measured on that vault (Apple silicon, Node 24): the MiniSearch cache is 22 MB with 1.56
million postings. Loading it costs about 45 ms for `JSON.parse` plus 135 ms for
`MiniSearch.loadJS`, which rebuilds every posting into `Map`s; with the freshness check
(listing and statting 20,000 files, about 120 ms) and the search itself, a warm query took
about 500 ms. A V8 structured-clone snapshot of MiniSearch's internals was slower (190 ms to
deserialize). Real notes have more distinct words than the synthetic ones, so a real vault of
that size would be worse, not better.

## Decision

`packages/cli/src/search.ts` keeps its own small inverted index:

- One file, `.kb/.cache/query-index.bin`: a JSON header (documents, sorted term dictionary,
  file manifest, folder mtimes, delta) followed by typed arrays of postings used in place.
  Loading parses the header and creates views; nothing is rebuilt.
- BM25 per field with boosts title 4, aliases 3, description 2, body 1; prefix and fuzzy
  expansion with MiniSearch's weights (0.375 and 0.45), OR semantics with a coverage factor.
- Freshness: folder mtimes tell which folders to re-list; each known file is statted once.
- Edited files go into a delta that is scored with the same statistics; the base is rebuilt
  when the delta passes 500 notes.

The Desk's `InMemoryKnowledge` (Plan 3) still uses MiniSearch; it builds in memory and never
loads a serialized index, so this does not affect it.

## Results

Synthetic 20,000-note vault: warm query 119 ms in process (median of 5; 305 ms for the whole
`kb query` process including Node start-up and loading the 2 MB bundle); cold build 5 s;
`kb query "re-enroll returning student"` still returns the returning-student note first on
`vault-acme`.
