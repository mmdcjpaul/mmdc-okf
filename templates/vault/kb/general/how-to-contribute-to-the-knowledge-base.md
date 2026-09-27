---
type: How-To
title: How to contribute to the knowledge base
description: Add or update a note in the vault by editing markdown, with a coding agent, or in the Lore Library.
version: 1.0.0
themes: [getting-started]
systems: [knowledge-base]
tags: [getting-started]
---

# When to use this

When you know something that is not written down yet, or a note is wrong.

# Steps

1. Search first: `kb query "<words>"`, or the Library search box. Prefer updating an existing
   note over creating a new one.
2. To create a note, run `kb new "How-To" "<specific title>" --ns <namespace> --theme <theme>`.
   Keep one idea per note and write a one-sentence description.
3. Link the note to at least one hub and to related notes with standard markdown links such as
   `[Getting started](/_themes/getting-started.md)`.
4. Run `kb lint --fix`, then commit and push or open a pull request. CI checks the same rules.

# Related

- [Getting started](/_themes/getting-started.md)
- [Knowledge base](/_systems/knowledge-base.md)
