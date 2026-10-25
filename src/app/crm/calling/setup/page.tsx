import { requireCrm } from "@/lib/auth/crm";
import { AGENT_NAME, AGENT_PROMPT, FIRST_MESSAGE, WEBHOOK_NOTES } from "@/lib/domain/ai-calling/prompt";
import { TOOL_HELP, TOOL_NAMES, toolParamsJson } from "@/lib/domain/ai-calling/tools";
import { providerStatus } from "@/lib/services/ai-calling/provider";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "AI agent setup · FITRON CRM" };

export default async function SetupPage() {
  await requireCrm("calling.view");
  const st = providerStatus();
  const site = (process.env.SITE_URL ?? "https://fitron.in").replace(/\/$/, "");
  return (
    <>
      <PageHeader kicker="AI Calling" title="Agent setup" subtitle={`Everything to copy into the ElevenLabs agent called “${AGENT_NAME}”. The exact steps are in docs/AI_CALLING.md.`} />
      <div className="mb-5"><Notice tone="accent">Voice Link: the numbers, SIP details and WebSocket protocol could not be verified from here, so none is filled in. Calls are placed through ElevenLabs over a SIP trunk. Send Voice Link the questions in docs/AI_CALLING.md (section 3).</Notice></div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Server settings (names only; values are never shown)">
          <ul className="flex flex-col gap-2 text-sm">{st.checks.map((c) => <li key={c.key} className="flex items-start justify-between gap-3"><span><code>{c.key}</code><div className="text-xs text-[var(--muted)]">{c.what}</div></span><Badge tone={c.ok ? "ok" : "alert"}>{c.ok ? "set" : "missing"}</Badge></li>)}</ul>
          <p className="mt-3 text-xs text-[var(--muted)]">Calls use {st.apiBase}. For India-resident workspaces set <code>ELEVENLABS_API_BASE</code> to the address ElevenLabs gives you.</p>
        </Card>
        <Card title="Addresses to give ElevenLabs">
          <dl className="grid gap-2 text-sm">
            <div><dt className="font-semibold">Post-call webhook</dt><dd className="break-all"><code>{site}/api/webhooks/calling/events</code></dd></div>
            <div><dt className="font-semibold">Tool address (replace the name)</dt><dd className="break-all"><code>{site}/api/webhooks/calling/tools/&lt;tool name&gt;</code></dd></div>
            <div><dt className="font-semibold">Header on every tool</dt><dd><code>x-fitron-tool-secret: &lt;CALLING_TOOL_SECRET&gt;</code></dd></div>
          </dl>
          <ul className="mt-3 list-disc pl-5 text-xs text-[var(--muted)]">{WEBHOOK_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
        </Card>
      </div>
      <div className="mt-5"><Card title="First message"><pre className="text-sm whitespace-pre-wrap">{FIRST_MESSAGE}</pre><p className="mt-1 text-xs text-[var(--muted)]">Dynamic variables to define on the agent: gym_name, owner_name, call_id, call_token.</p></Card></div>
      <div className="mt-5"><Card title="System prompt"><pre className="text-xs whitespace-pre-wrap">{AGENT_PROMPT}</pre></Card></div>
      <div className="mt-5"><Card title="Tools (method POST, body JSON)">
        <p className="mb-3 text-sm">For each tool, bind the parameters <code>call_id</code> and <code>call_token</code> to the dynamic variables of the same names, so the model can never choose them. The parameters below are the ones the model fills in.</p>
        <div className="flex flex-col gap-4">
          {TOOL_NAMES.map((n) => (
            <details key={n} className="rounded-[12px] border border-[var(--line)] p-3"><summary className="cursor-pointer text-sm font-semibold">{n}</summary>
              <p className="mt-2 text-sm">{TOOL_HELP[n]}</p>
              <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(toolParamsJson(n), null, 2)}</pre>
            </details>
          ))}
        </div>
      </Card></div>
    </>
  );
}
