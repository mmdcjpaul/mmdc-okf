import type { Nodes } from "mdast";
import { findMembersBlock } from "./hubs.ts";
import { noteAst, type ParsedNote } from "./note.ts";

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu;

export function countWordsIn(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

/**
 * Words of prose in a note body. Code blocks, HTML comments, link targets, frontmatter,
 * and the generated hub member list do not count.
 */
export function countWords(note: ParsedNote): number {
  const members = findMembersBlock(note.text);
  let words = 0;
  const walk = (node: Nodes): void => {
    if (
      node.type === "code" ||
      node.type === "html" ||
      node.type === "yaml" ||
      node.type === "definition"
    )
      return;
    const start = node.position?.start.offset;
    if (members && start !== undefined && start >= members.start && start < members.end) return;
    if (node.type === "text" || node.type === "inlineCode") {
      words += countWordsIn(node.value);
      return;
    }
    if ("children" in node) for (const child of node.children as Nodes[]) walk(child);
  };
  walk(noteAst(note));
  return words;
}
