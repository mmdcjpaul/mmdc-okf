import type { Metadata } from "next";
import { listTeams, listTerms, listUsers, pinnedHubs } from "@lore/db";
import { ActionForm } from "@/components/ActionForm";
import { adminButton, adminInput, adminQuiet } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { addTeam, changeMembership, editTeam } from "../actions";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage() {
  const ctx = await requireAdmin();
  const [teams, users, terms] = await Promise.all([
    listTeams(db()),
    listUsers(db()),
    listTerms(db(), ctx.vault.id),
  ]);
  const hubs = terms.filter((t) => t.kind !== "tag");
  const people = users.filter((u) => !u.serviceAccount);
  return (
    <div className="space-y-10">
      <section aria-label="Add a team">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Add a team</h2>
        <ActionForm action={addTeam} className="max-w-xl">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-[13px] font-medium text-ink">
              Name
              <input name="title" required className={`${adminInput} mt-1`} />
            </label>
            <label className="text-[13px] font-medium text-ink">
              Slug
              <input
                name="id"
                required
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder="finance-systems"
                className={`${adminInput} mt-1 font-mono text-[13px]`}
              />
            </label>
            <button type="submit" className={adminButton}>
              Add
            </button>
          </div>
        </ActionForm>
      </section>

      {await Promise.all(
        teams.map(async (t) => {
          const pins = new Set(
            (await pinnedHubs(db(), ctx.vault.id, [t.id])).map((p) => `${p.kind}:${p.slug}`),
          );
          const others = people.filter((u) => !t.members.some((m) => m.id === u.id));
          return (
            <section key={t.id} aria-label={t.title} className="rounded-lg border border-line p-4">
              <h2 className="text-[15px] font-semibold text-ink">
                {t.title}{" "}
                <code className="ml-1 font-mono text-[12px] font-normal text-muted">{t.id}</code>
              </h2>
              <h3 className="mb-1 mt-4 text-[13px] font-medium text-ink">Members</h3>
              <ul className="flex flex-wrap gap-2">
                {t.members.map((m) => (
                  <li key={m.id}>
                    <ActionForm
                      action={changeMembership}
                      className="inline-flex items-center gap-1"
                    >
                      <input type="hidden" name="teamId" value={t.id} />
                      <input type="hidden" name="userId" value={m.id} />
                      <input type="hidden" name="member" value="false" />
                      <span className="text-[13.5px] text-ink-2">{m.name}</span>
                      <button type="submit" className="text-[12.5px] text-accent hover:underline">
                        Remove
                        <span className="sr-only">
                          {" "}
                          {m.name} from {t.title}
                        </span>
                      </button>
                    </ActionForm>
                  </li>
                ))}
                {t.members.length === 0 ? (
                  <li className="text-[13.5px] text-muted">Nobody yet</li>
                ) : null}
              </ul>
              {others.length ? (
                <ActionForm action={changeMembership} className="mt-2 max-w-md">
                  <input type="hidden" name="teamId" value={t.id} />
                  <input type="hidden" name="member" value="true" />
                  <div className="flex items-end gap-2">
                    <label className="flex-1 text-[13px] font-medium text-ink">
                      Add a person to {t.title}
                      <select name="userId" className={`${adminInput} mt-1`}>
                        {others.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className={adminQuiet}>
                      Add
                    </button>
                  </div>
                </ActionForm>
              ) : null}

              <ActionForm action={editTeam} className="mt-4">
                <input type="hidden" name="id" value={t.id} />
                <label className="block max-w-md text-[13px] font-medium text-ink">
                  Name of {t.id}
                  <input name="title" defaultValue={t.title} className={`${adminInput} mt-1`} />
                </label>
                <fieldset className="mt-3">
                  <legend className="mb-1 text-[13px] font-medium text-ink">
                    Hubs pinned to the Home page of its members
                  </legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {hubs.map((h) => (
                      <label
                        key={`${h.kind}:${h.slug}`}
                        className="flex items-center gap-1.5 text-[13.5px] text-ink-2"
                      >
                        <input
                          type="checkbox"
                          name="pins"
                          value={`${h.kind}:${h.slug}`}
                          defaultChecked={pins.has(`${h.kind}:${h.slug}`)}
                          className="accent-[var(--accent)]"
                        />
                        {h.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button type="submit" className={`${adminQuiet} mt-3`}>
                  Save {t.title}
                </button>
              </ActionForm>
              <ActionForm
                action={editTeam}
                confirm={`Delete ${t.title}? Its memberships and grants go with it.`}
              >
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="intent" value="delete" />
                <button type="submit" className="text-[13px] text-bad hover:underline">
                  Delete {t.title}
                </button>
              </ActionForm>
            </section>
          );
        }),
      )}
    </div>
  );
}
