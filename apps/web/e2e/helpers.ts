import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { DATA_DIR, DATABASE_URL, REPO, VAULT, WORKER_ENV } from "./env.ts";

export type Person = "alice" | "bob" | "carol" | "dana" | "erin";

export const NAMES: Record<Person, string> = {
  alice: "Alice Reyes",
  bob: "Bob Chan",
  carol: "Carol Diaz",
  dana: "Dana Ito",
  erin: "Erin Garcia",
};

/** Tokens that exist only in restricted content (fixtures/README.md). */
export const CANARY = "zebra-payroll-canary";

export async function signIn(page: Page, who: Person): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(NAMES[who]) }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(NAMES[who].split(" ")[0]!);
}

export interface NoteRef {
  id: string;
  slug: string;
  title: string;
  path: string;
}

/** Looks a note up by its path in the vault, so specs do not hard-code ids. */
export async function noteAt(path: string): Promise<NoteRef> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<NoteRef[]>`
      select id, slug, title, path from notes where vault_id = ${VAULT} and path = ${path}`;
    if (!row) throw new Error(`No note at ${path}`);
    return row;
  } finally {
    await sql.end();
  }
}

export const noteUrl = (n: { id: string; slug: string }) => `/n/${n.id}/${n.slug}`;

/**
 * Commits to the bare repository from outside Lore, the way Obsidian or a coding agent would,
 * and indexes the push before returning.
 */
export function pushFromOutside(message: string, edit: (dir: string) => void): void {
  const bare = join(DATA_DIR, "vaults", `${VAULT}.git`);
  const work = mkdtempSync(join(tmpdir(), "lore-e2e-push-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", work, ...args], { encoding: "utf8", stdio: "pipe" });
  try {
    execFileSync("git", ["clone", "--quiet", "--branch", "main", bare, work], { stdio: "pipe" });
    edit(work);
    git("add", "-A");
    git(
      "-c",
      "user.name=External Editor",
      "-c",
      "user.email=external@acme.test",
      "commit",
      "--quiet",
      "-m",
      message,
    );
    git("push", "--quiet", "origin", "main");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  execFileSync(
    process.execPath,
    [join(REPO, "apps/worker/src/cli.ts"), "reindex", "--vault", VAULT],
    { env: { ...process.env, ...WORKER_ENV }, stdio: "pipe" },
  );
}

const BARE = join(DATA_DIR, "vaults", `${VAULT}.git`);

/** `git log` on the vault's branch, for checking what Lore committed. */
export function gitLog(format: string, n = 1): string {
  return execFileSync("git", ["--git-dir", BARE, "log", `-${n}`, `--format=${format}`, "main"], {
    encoding: "utf8",
  }).trim();
}

/** A file's text at the branch head, or null when it does not exist. */
export function fileAtHead(path: string): string | null {
  try {
    return execFileSync("git", ["--git-dir", BARE, "show", `main:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** Files the last commit changed. */
export function filesInLastCommit(): string[] {
  return execFileSync("git", ["--git-dir", BARE, "show", "--name-only", "--format=", "main"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

/** Puts the caret at the end of the editor's text and types. */
export async function appendToBody(page: Page, text: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Note body" });
  await bodyText(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText(text);
}

/** Replaces the editor's whole text. */
export async function replaceBody(page: Page, text: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Note body" });
  await bodyText(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

/**
 * The editor's text, line by line as CodeMirror holds it. Waits for the editor to have its
 * text first: on a slow machine the page is visible a moment before the editor is filled.
 */
export async function bodyText(page: Page): Promise<string> {
  const lines = page.getByRole("textbox", { name: "Note body" }).locator(".cm-line");
  await expect
    .poll(async () => (await lines.allInnerTexts()).join("").trim().length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  return (await lines.allInnerTexts()).join("\n");
}
