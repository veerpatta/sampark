import { redirect } from "next/navigation";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { campaignFor, isApiConfigured } from "@/lib/aisensy";
import { recentMessages } from "@/lib/whatsapp-log";
import {
  LANGUAGE_LABEL,
  TEMPLATE_BUTTON_BASE,
  allTemplates,
  expectedParamCount,
  type Language,
  type TemplateKind,
} from "@/lib/whatsapp-templates";
import { Card } from "@/components/admin/Card";
import { PageHeader } from "@/components/admin/PageHeader";
import { SettingsCrumbs } from "@/components/admin/SettingsCrumbs";
import { TestSend } from "./TestSend";

export const metadata = { title: "WhatsApp API — Sampark" };
export const dynamic = "force-dynamic";

/**
 * The API path, as something the owner can see and prove.
 *
 * Three questions, in the order they get asked: is sending on at all; what
 * exactly has to exist in the AiSensy dashboard for it to work; and what has
 * actually gone out. The templates are printed from the same constants the
 * builders fill, so what is pasted into AiSensy is what the app will send
 * params for — the alternative is a template typed by hand that differs by one
 * hole, which fails with "Template params does not match the campaign!" on the
 * first real round.
 *
 * The key itself is never shown, and never entered here: it lives in the
 * deployment's environment, and this screen only says whether it is there.
 */
export default async function WhatsappSettingsPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const enabled = isApiConfigured();
  const templates = allTemplates();
  const recent = await recentMessages(30);

  return (
    <div className="space-y-8">
      <PageHeader
        title="WhatsApp API"
        subtitle="Template messages through AiSensy. The Send and Remind buttons use these when the key is set; the wa.me links stay beside them either way."
      />
      <SettingsCrumbs current="/settings/whatsapp" />

      <Card title="Status">
        <dl className="mt-2 space-y-2 text-sm">
          <Row label="Sending">
            {enabled ? (
              <span className="text-[var(--color-confirm-fg)]">on — AISENSY_API_KEY is set</span>
            ) : (
              <span className="text-[var(--color-ink-muted)]">
                off — AISENSY_API_KEY is not set on this deployment. Every button is the wa.me link.
              </span>
            )}
          </Row>
          <Row label="Button base">
            <code className="font-mono text-xs">{TEMPLATE_BUTTON_BASE}&lt;token&gt;</code>
          </Row>
          <Row label="Campaigns">
            <span className="font-mono text-xs">
              {templates.map((spec) => campaignFor(kindOf(spec.name), spec.language)).join(" · ")}
            </span>
          </Row>
        </dl>
        <p className="mt-3 text-meta text-[var(--color-ink-muted)]">
          Set the key in Vercel for Production only. A preview deployment runs
          against a branch database whose tokens production does not hold, so a
          message sent from one would carry a link that 404s on her phone.
        </p>
      </Card>

      <Card title="Send a test">
        <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
          The request template with invented values, to any number. Its button
          opens a page that says it is a test. Run this once per language after
          the templates are approved — one send proves the campaign name, the
          number of values and the button together.
        </p>
        <TestSend enabled={enabled} />
      </Card>

      <Card title="The templates to create in AiSensy">
        <p className="text-sm text-[var(--color-ink-muted)]">
          Six templates, then six API campaigns named exactly as the templates
          are. Category Utility, one language each, body and footer verbatim,
          one URL button. After approval, create the API campaign for each and
          set it Live.
        </p>
        <ul className="mt-4 space-y-4">
          {templates.map((spec) => (
            <li
              key={spec.name}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-sm font-medium">{spec.name}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {LANGUAGE_LABEL[spec.language]} · {spec.category} ·{" "}
                  {expectedParamCount(kindOf(spec.name), spec.language)} body
                  variables + 1 button variable
                </span>
              </div>
              <pre
                lang={spec.languageCode}
                className="mt-2 whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm"
              >
                {spec.body}
              </pre>
              <dl className="mt-2 space-y-1 text-xs">
                <Row label="Footer">{spec.footer}</Row>
                <Row label="Button">
                  <span lang={spec.languageCode}>{spec.button.text}</span>{" "}
                  <code className="font-mono">→ {spec.button.url}</code>
                </Row>
                <Row label="Samples">
                  <span className="font-mono">{spec.samples.join(" · ")}</span>
                </Row>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent messages" flush>
        {recent.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]">
            Nothing has been sent through the API yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-ink-muted)]">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">To</th>
                  <th className="px-4 py-2 font-medium">What</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                      {WHEN.format(row.at)}
                    </td>
                    <td className="px-4 py-2">
                      {row.teacherName ?? <span className="text-[var(--color-ink-muted)]">test</span>}
                      <span className="ml-2 font-mono text-xs text-[var(--color-ink-muted)]">
                        {row.phone}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {row.campaignName}
                      {row.requestCount > 0 ? ` · ${row.requestCount} ${row.requestCount === 1 ? "link" : "links"}` : ""}
                    </td>
                    <td className="px-4 py-2">
                      {row.status === "sent" ? (
                        <span className="text-[var(--color-confirm-fg)]">sent</span>
                      ) : (
                        <span className="text-[var(--color-danger)]">
                          failed{row.error ? ` — ${row.error}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** `sampark_request_hi` → `request`. The name is built by templateName. */
function kindOf(name: string): TemplateKind {
  return name.split("_")[1] as TemplateKind;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      <dt className="w-24 shrink-0 text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

// Keep the Language import used: the label map is typed against it.
export type { Language };
