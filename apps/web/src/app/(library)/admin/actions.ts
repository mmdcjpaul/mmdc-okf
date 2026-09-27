"use server";

import { revalidatePath } from "next/cache";
import {
  AiSettings,
  encryptSecret,
  ModelRef,
  parseEncryptionKey,
  PROVIDERS,
  TASKS,
} from "@lore/ai";
import { newRecordId } from "@lore/changesets";
import {
  applyNamespaceSettings,
  countAdmins,
  createChangeset,
  createTeam,
  deleteTeam,
  getSetting,
  getUser,
  listNamespaces,
  listTeams,
  removeGrant,
  renameTeam,
  setGrant,
  setPinnedHubs,
  setSetting,
  setTeamMember,
  setUserRole,
  writeAudit,
  type ChangesetIntent,
} from "@lore/db";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSnapshot, requestProcessing, testProviderKey, type KeyTest } from "@/lib/worker";

export interface Result {
  ok: boolean;
  message: string;
}
const done = (message: string): Result => ({ ok: true, message });
const failed = (message: string): Result => ({ ok: false, message });
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** A change to the vault made from Admin: a changeset like any other, by the admin. */
async function vaultChange(intents: ChangesetIntent[], title: string): Promise<string> {
  const ctx = await requireAdmin();
  const row = await createChangeset(db(), {
    id: newRecordId("cs"),
    vaultId: ctx.vault.id,
    submitterId: ctx.principal.user.id,
    actor: `human:${ctx.principal.user.handle}`,
    source: "editor",
    changeClass: "fix",
    state: "submitted",
    title,
    ops: [],
    intents,
    baseShas: {},
    submittedAt: new Date(),
  });
  await requestProcessing(row.id);
  return row.id;
}

async function syncTeamsToVault(): Promise<void> {
  const teams = (await listTeams(db())).map((t) => t.id);
  await vaultChange([{ type: "set_teams", teams }], "update the list of teams");
}

export async function changeRole(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const userId = text(form, "userId");
  const role = text(form, "role");
  if (role !== "member" && role !== "admin") return failed("Choose member or admin");
  const user = await getUser(db(), userId);
  if (!user) return failed("No such person");
  if (user.role === "owner") return failed("The owner's role cannot be changed here");
  if (user.role === role) return done("Nothing changed");
  // The deployment must never be left with nobody who can manage it.
  if (role === "member" && (await countAdmins(db())) <= 1)
    return failed("There must be at least one admin");
  await setUserRole(db(), userId, role);
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "user.role",
    target: userId,
    metadata: { from: user.role, to: role },
  });
  revalidatePath("/admin");
  return done(`${user.name} is now ${role === "admin" ? "an admin" : "a member"}`);
}

export async function addTeam(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const id = text(form, "id");
  const title = text(form, "title");
  if (!SLUG.test(id)) return failed("The slug takes lowercase letters, digits, and hyphens");
  if (!title) return failed("Give the team a name");
  if (!(await createTeam(db(), id, title))) return failed(`There is already a team "${id}"`);
  await writeAudit(db(), { actorId: ctx.principal.user.id, action: "team.create", target: id });
  await syncTeamsToVault();
  revalidatePath("/admin/teams");
  return done(`Added ${title}`);
}

export async function editTeam(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const id = text(form, "id");
  const me = ctx.principal.user.id;
  if (form.get("intent") === "delete") {
    const owns = (await listNamespaces(db(), ctx.vault.id)).filter((n) => n.ownerTeam === id);
    if (owns.length)
      return failed(
        `This team owns ${owns.map((n) => n.title).join(", ")}. Give ${owns.length === 1 ? "it" : "them"} another owner first`,
      );
    await deleteTeam(db(), id);
    await writeAudit(db(), { actorId: me, action: "team.delete", target: id });
    await syncTeamsToVault();
    revalidatePath("/admin/teams");
    return done("Team deleted, with its memberships and grants");
  }
  const title = text(form, "title");
  if (title) {
    await renameTeam(db(), id, title);
    await writeAudit(db(), { actorId: me, action: "team.rename", target: id, metadata: { title } });
  }
  const pins = form
    .getAll("pins")
    .map(String)
    .flatMap((p) => {
      const [kind, slug] = p.split(":");
      return (kind === "theme" || kind === "system") && slug && SLUG.test(slug)
        ? [{ kind, slug } as const]
        : [];
    });
  const all =
    (await getSetting<Record<string, unknown>>(db(), `pinned_hubs:${ctx.vault.id}`)) ?? {};
  await setPinnedHubs(db(), ctx.vault.id, { ...all, [id]: pins } as never);
  revalidatePath("/admin/teams");
  return done("Saved");
}

export async function changeMembership(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const teamId = text(form, "teamId");
  const userId = text(form, "userId");
  const member = form.get("member") === "true";
  if (!teamId || !userId) return failed("Choose a person");
  await setTeamMember(db(), teamId, userId, member);
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: member ? "team.member_add" : "team.member_remove",
    target: teamId,
    metadata: { userId },
  });
  revalidatePath("/admin/teams");
  revalidatePath("/admin");
  return done(member ? "Added" : "Removed");
}

export async function grant(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const namespace = text(form, "namespace");
  const holder = text(form, "holder");
  const level = text(form, "level");
  if (!["read", "write", "maintain"].includes(level)) return failed("Choose a level");
  const [kind, id] = [holder.slice(0, holder.indexOf(":")), holder.slice(holder.indexOf(":") + 1)];
  if (!id || (kind !== "team" && kind !== "user")) return failed("Choose a team or a person");
  if (!(await listNamespaces(db(), ctx.vault.id)).some((n) => n.slug === namespace))
    return failed("No such namespace");
  await setGrant(db(), {
    vaultId: ctx.vault.id,
    namespace,
    level: level as "read" | "write" | "maintain",
    ...(kind === "team" ? { teamId: id } : { userId: id }),
  });
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "grant.set",
    target: namespace,
    metadata: { [kind]: id, level },
  });
  revalidatePath("/admin/namespaces");
  return done("Granted. It applies from the next request");
}

export async function revoke(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const removed = await removeGrant(db(), ctx.vault.id, Number(form.get("id")));
  if (!removed) return failed("That grant is already gone");
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "grant.remove",
    target: removed.namespace,
    metadata: { team: removed.teamId, user: removed.userId, level: removed.level },
  });
  revalidatePath("/admin/namespaces");
  return done("Removed");
}

export async function saveNamespace(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const slug = text(form, "slug");
  if (!SLUG.test(slug)) return failed("The slug takes lowercase letters, digits, and hyphens");
  const existing = (await listNamespaces(db(), ctx.vault.id)).find((n) => n.slug === slug);
  const creating = form.get("intent") === "create";
  if (creating && existing) return failed(`There is already a namespace "${slug}"`);
  if (!creating && !existing) return failed("No such namespace");
  const title = text(form, "title");
  if (creating && !title) return failed("Give the namespace a title");
  const visibility = text(form, "visibility") === "restricted" ? "restricted" : "company";
  const publishing = text(form, "publishing") === "auto" ? "auto" : "manual";
  const aiProcessing = form.get("ai") === "on";
  const owner = text(form, "owner") || null;
  if (owner && !(await listTeams(db())).some((t) => t.id === owner)) return failed("No such team");

  // In Postgres at once, so that restricting a namespace hides it on the next request. The
  // vault is the record: the same values reach it as a commit, and the indexer confirms them.
  if (existing)
    await applyNamespaceSettings(db(), ctx.vault.id, slug, {
      visibility,
      publishing,
      aiProcessing,
      ownerTeam: owner,
    });
  const id = await vaultChange(
    [
      {
        type: "set_namespace",
        slug,
        patch: {
          ...(title ? { title } : {}),
          ...(form.has("description") ? { description: text(form, "description") } : {}),
          owner,
          visibility,
          publishing,
          ai_processing: aiProcessing,
        },
      },
    ],
    creating ? `add namespace "${slug}"` : `change the settings of namespace "${slug}"`,
  );
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: creating ? "namespace.create" : "namespace.settings",
    target: slug,
    metadata: { visibility, publishing, aiProcessing, owner, changeset: id },
  });
  revalidatePath("/admin/namespaces");
  revalidatePath("/", "layout");
  return done(
    creating
      ? "Sent. A new namespace is reviewed like any new term: approve it under Review"
      : "Saved. It applies from the next request",
  );
}

async function readAi(): Promise<AiSettings> {
  return AiSettings.parse((await getSetting<unknown>(db(), "ai")) ?? {});
}

export async function saveKey(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const provider = text(form, "provider") as (typeof PROVIDERS)[number];
  if (!PROVIDERS.includes(provider)) return failed("No such provider");
  const settings = await readAi();
  const me = ctx.principal.user.id;
  if (form.get("intent") === "remove") {
    const { [provider]: _gone, ...keys } = settings.keys;
    await setSetting(db(), "ai", { ...settings, keys });
    await writeAudit(db(), { actorId: me, action: "ai.key_remove", target: provider });
    revalidatePath("/admin/ai");
    return done("Key removed");
  }
  const key = text(form, "key");
  if (key.length < 12) return failed("That does not look like a key");
  const secret = env().APP_ENCRYPTION_KEY;
  if (!secret) return failed("APP_ENCRYPTION_KEY is not set, so keys cannot be stored");
  const stored = encryptSecret(key, parseEncryptionKey(secret), `keys.${provider}`);
  await setSetting(db(), "ai", { ...settings, keys: { ...settings.keys, [provider]: stored } });
  // The audit log says that a key was saved, and nothing about the key.
  await writeAudit(db(), { actorId: me, action: "ai.key_set", target: provider });
  revalidatePath("/admin/ai");
  return done(`Key saved. It ends in ${key.slice(-4)}`);
}

export async function testKey(_prev: KeyTest | null, form: FormData): Promise<KeyTest> {
  await requireAdmin();
  return testProviderKey(text(form, "provider"));
}

export async function saveTasks(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const settings = await readAi();
  const tasks: Record<string, unknown> = {};
  for (const task of TASKS) {
    const primary = text(form, `${task}.primary`);
    if (!primary) continue;
    const fallback = text(form, `${task}.fallback`);
    for (const ref of [primary, fallback].filter(Boolean))
      if (!ModelRef.safeParse(ref).success)
        return failed(`"${ref}" is not a model. Write it as provider:model`);
    const budget = text(form, `${task}.budget`);
    tasks[task] = {
      ...(settings.tasks[task] ?? {}),
      primary,
      ...(fallback ? { fallback } : { fallback: undefined }),
      ...(budget ? { budgetUsd: Number(budget) } : { budgetUsd: undefined }),
    };
  }
  const budgets = {
    orgMonthlyUsd: Number(text(form, "orgMonthlyUsd") || settings.budgets.orgMonthlyUsd),
    personDailyUsd: Number(text(form, "personDailyUsd") || settings.budgets.personDailyUsd),
    alertAt: settings.budgets.alertAt,
  };
  const next = AiSettings.safeParse({ ...settings, tasks, budgets });
  if (!next.success) return failed(next.error.issues[0]?.message ?? "Not valid");
  await setSetting(db(), "ai", next.data);
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "ai.settings",
    metadata: { budgets, tasks: Object.keys(tasks) },
  });
  revalidatePath("/admin/ai");
  return done("Saved");
}

export async function saveBranding(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const accent = text(form, "accent");
  const logoUrl = text(form, "logoUrl");
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) return failed("Write the colour as #rrggbb");
  if (logoUrl && !/^(https:\/\/|\/)/.test(logoUrl))
    return failed("The logo address must start with https:// or /");
  const branding = {
    name: text(form, "name").slice(0, 60),
    logoUrl: logoUrl || null,
    accent: accent || null,
    deskGreeting: text(form, "deskGreeting").slice(0, 300) || null,
  };
  const on = (name: string) => form.get(name) === "on";
  const features = {
    desk: on("desk"),
    capture: on("capture"),
    graph: on("graph"),
    gardener: on("gardener"),
    autoPublishing: on("autoPublishing"),
  };
  await setSetting(db(), "branding", branding);
  await setSetting(db(), "features", features);
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "settings.branding",
    metadata: { ...branding, ...features },
  });
  revalidatePath("/", "layout");
  return done("Saved");
}

export async function takeSnapshot(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireAdmin();
  const name = text(form, "name");
  if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(name))
    return failed("The name takes lowercase letters, digits, dots, and hyphens");
  const error = await createSnapshot(
    ctx.vault.id,
    name,
    `${text(form, "note") || "Snapshot"}\n\nTaken by ${ctx.principal.user.name} in Lore Admin.`,
  );
  if (error) return failed(error);
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "vault.snapshot",
    target: name,
  });
  revalidatePath("/admin/snapshots");
  return done(`Tagged ${name}`);
}
