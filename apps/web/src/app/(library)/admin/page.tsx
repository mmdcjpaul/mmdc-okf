import type { Metadata } from "next";
import { listTeams, listUsersWithTeams } from "@lore/db";
import { ActionForm } from "@/components/ActionForm";
import { adminInput, adminQuiet } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { changeRole } from "./actions";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const ctx = await requireAdmin();
  const [users, teams] = await Promise.all([listUsersWithTeams(db()), listTeams(db())]);
  const title = new Map(teams.map((t) => [t.id, t.title]));
  return (
    <section aria-label="People">
      <p className="mb-4 max-w-2xl text-[14px] text-muted">
        People are added the first time they sign in. Admins manage people, teams, grants, and
        settings. What someone can read and write comes from grants, under Namespaces.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[13.5px]">
          <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Person
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Teams
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Role
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {users.map((u) => (
              <tr key={u.id}>
                <th scope="row" className="px-3 py-2.5 font-normal">
                  <span className="block font-medium text-ink">{u.name}</span>
                  <span className="text-[12.5px] text-muted">
                    {u.email}
                    {u.serviceAccount ? " · service account" : ""}
                  </span>
                </th>
                <td className="px-3 py-2.5 text-ink-2">
                  {u.teams.map((t) => title.get(t) ?? t).join(", ") || (
                    <span className="text-muted">None</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {u.role === "owner" || u.serviceAccount ? (
                    <span className="capitalize text-ink-2">{u.role}</span>
                  ) : (
                    <ActionForm action={changeRole} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        aria-label={`Role of ${u.name}`}
                        className={`${adminInput} h-8 w-auto`}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button type="submit" className={adminQuiet}>
                        Save
                      </button>
                      {u.id === ctx.principal.user.id ? (
                        <span className="text-[12.5px] text-muted">This is you</span>
                      ) : null}
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
