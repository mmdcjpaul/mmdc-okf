import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DiskSource, loadVault, parseActor, type FileOp, type Vault } from "@lore/okf";

/** A usage problem: exit code 2. */
export class UsageError extends Error {}

/** A validation failure: exit code 1. */
export class ValidationFailure extends Error {}

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export const stdio: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

/** Walks up from `start` to the folder holding `.kb/`, the vault root. */
export function findVaultRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".kb"))) return dir;
    const parent = dirname(dir);
    if (parent === dir)
      throw new UsageError(
        `No vault found: no .kb/ folder in ${resolve(start)} or any parent. Run kb inside a vault or pass --dir.`,
      );
    dir = parent;
  }
}

export interface Context {
  root: string;
  io: Io;
  env: NodeJS.ProcessEnv;
  now: Date;
  vault(): Promise<Vault>;
  actor(): Actor;
  apply(ops: FileOp[]): void;
}

type Actor = string;

export function createContext(opts: {
  dir?: string;
  io?: Io;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Context {
  const root = findVaultRoot(opts.dir ?? process.cwd());
  const io = opts.io ?? stdio;
  const env = opts.env ?? process.env;
  return {
    root,
    io,
    env,
    now: opts.now ?? (env.KB_NOW ? new Date(env.KB_NOW) : new Date()),
    vault: () => loadVault(new DiskSource(root)),
    actor: () => resolveActor(root, env),
    apply: (ops) => applyOps(root, ops, io),
  };
}

/** `KB_ACTOR`, or `human:<local part of git user.email>`. */
export function resolveActor(root: string, env: NodeJS.ProcessEnv): string {
  if (env.KB_ACTOR) {
    if (!parseActor(env.KB_ACTOR))
      throw new UsageError(
        `KB_ACTOR "${env.KB_ACTOR}" must be human:<id>, <agent>/<model>, or process:<name>`,
      );
    return env.KB_ACTOR;
  }
  let email = "";
  try {
    email = execFileSync("git", ["config", "user.email"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // no git or no email configured
  }
  const local = email.split("@")[0];
  if (!local)
    throw new UsageError("Cannot tell who you are: set KB_ACTOR or git config user.email");
  return `human:${local}`;
}

export function applyOps(root: string, ops: FileOp[], io: Io): void {
  for (const op of ops) {
    const full = join(root, op.path);
    if (op.op === "put") {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, op.content);
      io.out(`  wrote   ${op.path}\n`);
    } else {
      rmSync(full, { force: true });
      io.out(`  deleted ${op.path}\n`);
    }
  }
}

/** Splits repeated or comma-separated option values. */
export function list(values: string[] | string | undefined): string[] {
  if (!values) return [];
  return (Array.isArray(values) ? values : [values])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}
