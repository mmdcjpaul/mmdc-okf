import type { Metadata } from "next";
import {
  AiSettings,
  DEFAULT_PRICES,
  PROVIDERS,
  priceKey,
  splitModelRef,
  taskConfig,
  TASKS,
} from "@lore/ai";
import { getSetting, spentSince, usageByTask } from "@lore/db";
import { Banner } from "@lore/ui";
import { ActionForm, TestKeyForm } from "@/components/ActionForm";
import { adminButton, adminInput, adminQuiet } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { saveKey, saveTasks, testKey } from "../actions";

export const metadata: Metadata = { title: "AI" };

const NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
};
const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;

export default async function AiPage() {
  await requireAdmin();
  const settings = AiSettings.parse((await getSetting<unknown>(db(), "ai")) ?? {});
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [spent, usage] = await Promise.all([spentSince(db(), month), usageByTask(db(), month)]);
  const mode = env().AI_MODE;
  const uses = (provider: string) =>
    TASKS.filter((t) => {
      const c = taskConfig(settings, t);
      return [c.primary, c.fallback].some((m) => m && splitModelRef(m).provider === provider);
    });
  const prices = { ...DEFAULT_PRICES, ...settings.prices };
  const unpriced = [
    ...new Set(
      TASKS.flatMap((t) => {
        const c = taskConfig(settings, t);
        return [c.primary, c.fallback].filter((m): m is string => !!m);
      }).filter((m) => !prices[m] && !prices[priceKey(m)]),
    ),
  ];
  const share = settings.budgets.orgMonthlyUsd ? spent / settings.budgets.orgMonthlyUsd : 0;

  return (
    <div className="space-y-10">
      {mode !== "live" ? (
        <Banner kind="info" title={mode === "off" ? "AI is turned off" : "AI is scripted"}>
          {mode === "off"
            ? "This deployment runs with AI_MODE=off. No model is called, whatever is saved here."
            : "This deployment runs with AI_MODE=fake. Answers come from scripts, and nothing is spent."}
        </Banner>
      ) : null}
      {share >= settings.budgets.alertAt ? (
        <Banner kind="stale" title={`${Math.round(share * 100)}% of this month's budget is used`}>
          {usd(spent)} of {usd(settings.budgets.orgMonthlyUsd)}. When it is used up, uploads wait
          and the rest of the Library keeps working.
        </Banner>
      ) : null}

      <section aria-label="Provider keys">
        <h2 className="text-[15px] font-semibold text-ink">Provider keys</h2>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-muted">
          Keys are encrypted before they are stored and are never shown again, here or anywhere. To
          change one, save a new one over it.
        </p>
        {env().APP_ENCRYPTION_KEY ? null : (
          <div className="mb-3">
            <Banner kind="reported" title="Keys cannot be saved yet">
              Set APP_ENCRYPTION_KEY for the web app and the worker, then come back.
            </Banner>
          </div>
        )}
        <ul className="space-y-3">
          {PROVIDERS.map((p) => {
            const tasks = uses(p);
            const saved = !!settings.keys[p];
            return (
              <li key={p} className="rounded-lg border border-line p-4">
                <h3 className="text-[14px] font-semibold text-ink">
                  {NAMES[p]}
                  <span
                    className={`ml-2 text-[12.5px] font-normal ${saved ? "text-ok" : "text-muted"}`}
                  >
                    {saved ? "A key is saved" : "No key"}
                  </span>
                </h3>
                <p className="mt-0.5 text-[13px] text-muted">
                  {tasks.length ? `Used by ${tasks.join(", ")}` : "No task uses this provider"}
                </p>
                <ActionForm action={saveKey} className="mt-2">
                  <input type="hidden" name="provider" value={p} />
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[240px] flex-1 text-[13px] font-medium text-ink">
                      {saved ? `New key for ${NAMES[p]}` : `Key for ${NAMES[p]}`}
                      <input
                        name="key"
                        type="password"
                        autoComplete="off"
                        required
                        className={`${adminInput} mt-1 font-mono text-[13px]`}
                      />
                    </label>
                    <button type="submit" className={adminQuiet}>
                      Save key
                    </button>
                  </div>
                </ActionForm>
                {saved ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <TestKeyForm action={testKey} provider={p} />
                    <ActionForm
                      action={saveKey}
                      className="[&>p]:hidden"
                      confirm={`Remove the ${NAMES[p]} key? Tasks that use it stop working.`}
                    >
                      <input type="hidden" name="provider" value={p} />
                      <input type="hidden" name="intent" value="remove" />
                      <button type="submit" className="text-[13px] text-bad hover:underline">
                        Remove the {NAMES[p]} key
                      </button>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Models and budgets">
        <h2 className="text-[15px] font-semibold text-ink">Models and budgets</h2>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-muted">
          Each task names its model as provider:model. The fallback is used when the primary fails,
          times out, or is rate limited.
        </p>
        {unpriced.length ? (
          <div className="mb-3">
            <Banner kind="stale" title="Some models have no price">
              {unpriced.join(", ")}: calls are logged with their tokens and a cost of zero, so
              budgets cannot see them. Add prices to the ai setting.
            </Banner>
          </div>
        ) : null}
        <ActionForm action={saveTasks}>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-[13.5px]">
              <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Task
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Primary
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Fallback
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Monthly budget ($)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {TASKS.map((t) => {
                  const c = taskConfig(settings, t);
                  return (
                    <tr key={t}>
                      <th
                        scope="row"
                        className="px-3 py-2 font-mono text-[12.5px] font-normal text-ink"
                      >
                        {t}
                      </th>
                      <td className="px-3 py-2">
                        <input
                          name={`${t}.primary`}
                          defaultValue={c.primary}
                          aria-label={`Primary model for ${t}`}
                          className={`${adminInput} h-8 font-mono text-[12.5px]`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          name={`${t}.fallback`}
                          defaultValue={c.fallback ?? ""}
                          aria-label={`Fallback model for ${t}`}
                          className={`${adminInput} h-8 font-mono text-[12.5px]`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          name={`${t}.budget`}
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={c.budgetUsd ?? ""}
                          aria-label={`Monthly budget for ${t}`}
                          className={`${adminInput} h-8 w-28`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
            <label className="text-[13px] font-medium text-ink">
              Whole organization, per month ($)
              <input
                name="orgMonthlyUsd"
                type="number"
                min="0"
                step="1"
                defaultValue={settings.budgets.orgMonthlyUsd}
                className={`${adminInput} mt-1`}
              />
            </label>
            <label className="text-[13px] font-medium text-ink">
              Each person, per day ($)
              <input
                name="personDailyUsd"
                type="number"
                min="0"
                step="0.5"
                defaultValue={settings.budgets.personDailyUsd}
                className={`${adminInput} mt-1`}
              />
            </label>
          </div>
          <button type="submit" className={`${adminButton} mt-4`}>
            Save models and budgets
          </button>
        </ActionForm>
      </section>

      <section aria-label="Usage this month">
        <h2 className="text-[15px] font-semibold text-ink">Usage this month</h2>
        <p className="mb-3 mt-1 text-[13px] text-muted">
          {usd(spent)} of {usd(settings.budgets.orgMonthlyUsd)} spent.
        </p>
        {usage.length ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-[13.5px]">
              <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Task
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Model
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Calls
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Failed
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Tokens in
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    From cache
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Tokens out
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2 tabular-nums">
                {usage.map((u) => (
                  <tr key={`${u.task}:${u.model}`}>
                    <th
                      scope="row"
                      className="px-3 py-2 font-mono text-[12.5px] font-normal text-ink"
                    >
                      {u.task}
                    </th>
                    <td className="px-3 py-2 font-mono text-[12.5px] text-ink-2">{u.model}</td>
                    <td className="px-3 py-2 text-right">{u.calls}</td>
                    <td className="px-3 py-2 text-right">{u.failed}</td>
                    <td className="px-3 py-2 text-right">{u.inputTokens.toLocaleString("en")}</td>
                    <td className="px-3 py-2 text-right">{u.cachedTokens.toLocaleString("en")}</td>
                    <td className="px-3 py-2 text-right">{u.outputTokens.toLocaleString("en")}</td>
                    <td className="px-3 py-2 text-right">${u.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13.5px] text-muted">No model has been called this month.</p>
        )}
      </section>
    </div>
  );
}
