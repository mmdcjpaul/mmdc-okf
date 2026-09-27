import type { Metadata } from "next";
import { listGrants, listNamespaces, listTeams, listUsers } from "@lore/db";
import { ActionForm } from "@/components/ActionForm";
import { adminButton, adminInput, adminQuiet } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { grant, revoke, saveNamespace } from "../actions";

export const metadata: Metadata = { title: "Namespaces" };

const LEVEL = { read: "Read", write: "Write", maintain: "Maintain" } as const;

export default async function NamespacesPage() {
  const ctx = await requireAdmin();
  const [namespaces, grants, teams, users] = await Promise.all([
    listNamespaces(db(), ctx.vault.id),
    listGrants(db(), ctx.vault.id),
    listTeams(db()),
    listUsers(db()),
  ]);
  const holders = (
    <>
      <optgroup label="Teams">
        {teams.map((t) => (
          <option key={t.id} value={`team:${t.id}`}>
            {t.title}
          </option>
        ))}
      </optgroup>
      <optgroup label="People">
        {users.map((u) => (
          <option key={u.id} value={`user:${u.id}`}>
            {u.name}
          </option>
        ))}
      </optgroup>
    </>
  );
  const fields = (ns?: (typeof namespaces)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-[13px] font-medium text-ink">
        Visibility
        <select
          name="visibility"
          defaultValue={ns?.visibility ?? "company"}
          className={`${adminInput} mt-1`}
        >
          <option value="company">Company: every member can read it</option>
          <option value="restricted">Restricted: only those with a grant</option>
        </select>
      </label>
      <label className="text-[13px] font-medium text-ink">
        Owner team
        <select name="owner" defaultValue={ns?.ownerTeam ?? ""} className={`${adminInput} mt-1`}>
          <option value="">None</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px] font-medium text-ink">
        Publishing
        <select
          name="publishing"
          defaultValue={ns?.publishing ?? "manual"}
          className={`${adminInput} mt-1`}
        >
          <option value="manual">Manual: every AI draft is reviewed</option>
          <option value="auto">Automatic: AI drafts publish unless a review rule fires</option>
        </select>
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-[13.5px] text-ink-2">
        <input
          type="checkbox"
          name="ai"
          defaultChecked={ns?.aiProcessing ?? true}
          className="size-4 accent-[var(--accent)]"
        />
        AI processing allowed
      </label>
    </div>
  );

  return (
    <div className="space-y-8">
      {namespaces.map((ns) => {
        const mine = grants.filter((g) => g.namespace === ns.slug);
        return (
          <section
            key={ns.slug}
            aria-label={ns.title}
            className="rounded-lg border border-line p-4"
          >
            <h2 className="text-[15px] font-semibold text-ink">
              {ns.title}{" "}
              <code className="ml-1 font-mono text-[12px] font-normal text-muted">{ns.slug}</code>
            </h2>
            <ActionForm action={saveNamespace} className="mt-3">
              <input type="hidden" name="slug" value={ns.slug} />
              {fields(ns)}
              <button type="submit" className={`${adminQuiet} mt-3`}>
                Save {ns.title}
              </button>
            </ActionForm>

            <h3 className="mb-1 mt-3 text-[13px] font-medium text-ink">Grants</h3>
            {mine.length ? (
              <ul className="divide-y divide-line-2 rounded-md border border-line">
                {mine.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 px-3 py-1.5 text-[13.5px]">
                    <span className="flex-1 text-ink-2">
                      {g.teamTitle ?? g.userName ?? g.teamId ?? g.userId}
                      <span className="ml-1.5 text-[12px] text-muted">
                        {g.teamId ? "team" : "person"}
                      </span>
                    </span>
                    <span className="text-ink">{LEVEL[g.level]}</span>
                    <ActionForm action={revoke} className="[&>p]:hidden">
                      <input type="hidden" name="id" value={g.id} />
                      <button type="submit" className="text-[12.5px] text-accent hover:underline">
                        Remove
                        <span className="sr-only">
                          {" "}
                          the grant of {g.teamTitle ?? g.userName} on {ns.title}
                        </span>
                      </button>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted">
                {ns.visibility === "company"
                  ? "No grants. Every member can read it; nobody can write."
                  : "No grants. Only admins can read it."}
              </p>
            )}
            <ActionForm action={grant} className="mt-2" label={`Grant on ${ns.title}`}>
              <input type="hidden" name="namespace" value={ns.slug} />
              <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto] sm:items-end">
                <label className="text-[13px] font-medium text-ink">
                  Give access to
                  <select name="holder" className={`${adminInput} mt-1`}>
                    {holders}
                  </select>
                </label>
                <label className="text-[13px] font-medium text-ink">
                  Level
                  <select name="level" defaultValue="write" className={`${adminInput} mt-1`}>
                    <option value="read">Read</option>
                    <option value="write">Write</option>
                    <option value="maintain">Maintain</option>
                  </select>
                </label>
                <button type="submit" className={adminQuiet}>
                  Grant
                </button>
              </div>
            </ActionForm>
          </section>
        );
      })}

      <section
        aria-label="Add a namespace"
        className="rounded-lg border border-dashed border-line p-4"
      >
        <h2 className="text-[15px] font-semibold text-ink">Add a namespace</h2>
        <p className="mt-1 text-[13px] text-muted">
          A namespace is a top-level folder in the vault. New ones start with manual publishing.
        </p>
        <ActionForm action={saveNamespace} className="mt-3">
          <input type="hidden" name="intent" value="create" />
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[13px] font-medium text-ink">
              Title
              <input name="title" required className={`${adminInput} mt-1`} />
            </label>
            <label className="text-[13px] font-medium text-ink">
              Slug
              <input
                name="slug"
                required
                pattern="[a-z0-9][a-z0-9-]*"
                className={`${adminInput} mt-1 font-mono text-[13px]`}
              />
            </label>
            <label className="text-[13px] font-medium text-ink sm:col-span-2">
              Description
              <input name="description" className={`${adminInput} mt-1`} />
            </label>
          </div>
          {fields()}
          <button type="submit" className={`${adminButton} mt-3`}>
            Add the namespace
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
