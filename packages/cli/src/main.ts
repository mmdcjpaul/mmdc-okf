import { Command, CommanderError, Option } from "commander";
import {
  bumpCommand,
  indexCommand,
  lintCommand,
  migrateCommand,
  mvCommand,
  newCommand,
  queryCommand,
  relatedCommand,
  taxonomyAdd,
  taxonomyList,
  taxonomyMerge,
  taxonomyRename,
  verifyCommand,
} from "./commands.ts";
import { createContext, stdio, UsageError, ValidationFailure, type Io } from "./context.ts";

declare const __KB_VERSION__: string | undefined;
const VERSION = typeof __KB_VERSION__ === "string" ? __KB_VERSION__ : "1.0.0-dev";

const collect = (value: string, previous: string[] = []) => [...previous, value];

/** Runs the CLI and returns its exit code: 0 success, 1 validation failure, 2 usage error. */
export async function run(
  argv: string[],
  opts: { io?: Io; env?: NodeJS.ProcessEnv; cwd?: string; now?: Date } = {},
): Promise<number> {
  const io = opts.io ?? stdio;
  const program = new Command("kb");
  let exitCode = 0;
  program
    .description("Lint, index, search, and edit an OKF knowledge vault.")
    .version(VERSION)
    .option("-C, --dir <path>", "vault root (default: nearest folder with .kb/)")
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s), writeErr: (s) => io.err(s) })
    .showHelpAfterError("(run kb --help for usage)");

  const ctx = () =>
    createContext({
      dir: program.opts().dir ?? opts.cwd ?? process.cwd(),
      io,
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
  const action =
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
    async (...args: A) => {
      await fn(...args);
    };

  program
    .command("lint")
    .description("Validate notes; exit 1 on errors")
    .argument("[paths...]", "files or folders to report on")
    .option("--fix", "fix what is safe to fix")
    .addOption(
      new Option("--format <formats>", "human, json, github (comma-separated)").default("human"),
    )
    .action(action((paths: string[], o) => lintCommand(ctx(), paths, o)));

  program
    .command("new")
    .description("Create a note from the type's template with a fresh id")
    .argument("<type>", 'note type, for example "How-To"')
    .argument("<title>", "specific title that could answer a search")
    .requiredOption("--ns <namespace>", "namespace (top-level folder)")
    .option("--theme <theme>", "theme slug (repeat or comma-separate, 1 to 3)", collect)
    .option("--system <system>", "system slug", collect)
    .option("--tag <tag>", "tag", collect)
    .option("--folder <folder>", "subfolder inside the namespace")
    .option("--description <text>", "one-sentence description")
    .option("--draft", "start as a draft (version 0.1.0)")
    .action(action((type: string, title: string, o) => newCommand(ctx(), type, title, o)));

  program
    .command("query")
    .description("Offline full-text search over the vault")
    .argument("<text>", "search words")
    .option("--ns <namespace>", "only this namespace")
    .option("--type <type>", "only this note type")
    .option("--limit <n>", "maximum results", "10")
    .option("--json", "JSON output")
    .action(action((text: string, o) => queryCommand(ctx(), text, o)));

  program
    .command("related")
    .description("Linked and similar notes")
    .argument("<note>", "path or id")
    .option("--remote", "semantic similarity through the Lore API")
    .option("--limit <n>", "maximum per section", "10")
    .option("--json", "JSON output")
    .action(action((note: string, o) => relatedCommand(ctx(), note, o)));

  program
    .command("index")
    .description("Regenerate index files, hub member lists, graph.json, and graph-report.md")
    .option("--check", "exit 1 if anything is out of date, without writing")
    .action(action((o) => indexCommand(ctx(), o)));

  program
    .command("mv")
    .description("Move or rename a note and rewrite inbound links")
    .argument("<from>")
    .argument("<to>")
    .action(action((from: string, to: string) => mvCommand(ctx(), from, to)));

  program
    .command("bump")
    .description("Bump a note's version by change class; process changes write the log entry")
    .argument("<path>")
    .requiredOption("--class <class>", "fix, addition, or process")
    .option("--summary <text>", "what changed, for the log entry")
    .action(action((path: string, o) => bumpCommand(ctx(), path, o)));

  program
    .command("verify")
    .description("Record that you checked a note is accurate (people only)")
    .argument("<path>")
    .action(action((path: string) => verifyCommand(ctx(), path)));

  const taxonomy = program
    .command("taxonomy")
    .description("Manage namespaces, themes, systems, and tags");
  taxonomy
    .command("list")
    .description("List the vocabulary")
    .option("--kind <kind>", "namespaces, types, themes, systems, tags, or teams")
    .option("--json", "JSON output")
    .action(action((o) => taxonomyList(ctx(), o)));
  taxonomy
    .command("add")
    .description("Add a tag, or create a theme or system hub")
    .argument("<kind>", "theme, system, or tag")
    .argument("<slug>")
    .option("--title <title>")
    .option("--description <text>")
    .option("--alias <alias>", "alias (repeatable)", collect)
    .action(action((kind: string, slug: string, o) => taxonomyAdd(ctx(), kind, slug, o)));
  taxonomy
    .command("rename")
    .description("Rename a term and rewrite every note that uses it")
    .argument("<kind>")
    .argument("<from>")
    .argument("<to>")
    .action(
      action((kind: string, from: string, to: string) => taxonomyRename(ctx(), kind, from, to)),
    );
  taxonomy
    .command("merge")
    .description("Merge terms into one")
    .argument("<kind>")
    .argument("<from...>")
    .requiredOption("--into <term>")
    .action(action((kind: string, from: string[], o) => taxonomyMerge(ctx(), kind, from, o)));

  program
    .command("migrate")
    .description("Upgrade the vault to a new profile or OKF version")
    .option("--to <version>", "target OKF version", "0.2")
    .option("--dry-run", "show what would change")
    .action(action((o) => migrateCommand(ctx(), o)));

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) {
      exitCode =
        err.code === "commander.helpDisplayed" ||
        err.code === "commander.version" ||
        err.exitCode === 0
          ? 0
          : 2;
    } else if (err instanceof UsageError) {
      io.err(`kb: ${err.message}\n`);
      exitCode = 2;
    } else if (err instanceof ValidationFailure) {
      if (!/lint errors|out of date/.test(err.message)) io.err(`kb: ${err.message}\n`);
      exitCode = 1;
    } else {
      io.err(`kb: ${(err as Error).stack ?? String(err)}\n`);
      exitCode = 1;
    }
  }
  return exitCode;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/kb.js") ||
  process.argv[1]?.endsWith("/kb");
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
