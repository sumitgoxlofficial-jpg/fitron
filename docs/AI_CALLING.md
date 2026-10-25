# AI Calling: the FITRON AI Sales Agent

An outbound calling agent for FITRON's sales team, run from the Super Admin's CRM (**/crm/calling**). It phones gym
owners who have given a reason to be called, talks to them through an ElevenLabs conversational agent, books demos, and
writes everything it learns into the CRM lead.

**Read this first.** The FITRON side is built and tested. The parts that need your Voice Link and ElevenLabs accounts
have **not** been run against the real services, because this build environment could not reach either provider's
documentation or API (see §2 and §10). Nothing here claims a real call has been placed.

## 1. What is built

| Part | Where |
| --- | --- |
| Rules (pure code, unit tested): who may be called, signatures, offer, demo slots, tool schemas, agent prompt | `src/lib/domain/ai-calling/` |
| Services (database, dialer, tools, webhook, reports) | `src/lib/services/ai-calling/` |
| Agent tool endpoints | `POST /api/webhooks/calling/tools/<tool>` |
| Post-call webhook | `POST /api/webhooks/calling/events` |
| Dialer worker (every 30 minutes) | `GET /api/jobs/calls` (`.github/workflows/jobs.yml`, `deploy/scheduler.sh`) |
| Super Admin pages | Overview, Campaigns, Call history, Permission & do-not-call, Settings & test call, Agent setup |
| Tables | `AcSetting`, `AcCampaign`, `AcCall`, `AcDemo`, `AcConsent`, `AcSuppression` (row-level security on, migration `20261025090000_ai_calling`) |

It reuses the CRM's leads, stages, tasks, notifications and audit trail; it adds no second lead system. Permissions
`calling.view` and `calling.manage` belong to the Super Admin only.

## 2. What was verified about the providers (and what was not)

Found by search only: the providers' own sites could not be opened from the build environment (the network refused
`voicelink.co.in`, `elevenlabs.io` and `trai.gov.in`). Treat everything below as leads to confirm, not as documentation.

**Voice Link (voicelink.co.in, by Elision Technologies).** Its public pages describe Indian numbers for voice bots with
SIP and WebSocket connectivity, a reseller plan, a *WebSocket Management* module (outbound call queues that can be
paused, resumed and removed) and a *WebSocket Time Group* module (weekly schedules for outbound campaigns). Release notes
mention APIs for reassigning DIDs, SIP call webhooks and wallet balances. **No public outbound-call API reference, WebSocket
message format, audio codec, webhook format or authentication scheme was found.** None of it has been guessed or coded.
The WebSocket-bot route is therefore **not implemented**. Do not paste an ElevenLabs address into a Voice Link WebSocket
field: that field expects an audio-streaming server speaking Voice Link's own protocol.

**ElevenLabs.** From its public reference (as returned by search): `POST /v1/convai/sip-trunk/outbound-call` with header
`xi-api-key` and body `agent_id`, `agent_phone_number_id`, `to_number`, optional `conversation_initiation_client_data`
(this is how the call's id and key reach the agent as dynamic variables); the answer carries `conversation_id` and
`sip_call_id`. Post-call webhooks are signed: header `ElevenLabs-Signature: t=<unix seconds>,v0=<hex HMAC-SHA256 of "t.rawBody">`,
event types `post_call_transcription` and `call_initiation_failure`. Providers' own guides (Plivo, Ozonetel) state that calls
to or from India need an **India-resident ElevenLabs workspace** (an Enterprise option) or they fail with a regulatory error,
and that the trunk then points at ElevenLabs' India SIP address. Confirm all of this with ElevenLabs sales.

**What this means for the design.** The one route that needs no Voice Link-specific API is: *Voice Link gives you a SIP
trunk → you import it into ElevenLabs as a phone number → FITRON asks ElevenLabs to place the call*. That is what is built.
It works only if Voice Link can supply SIP credentials for your number. If it can only offer its WebSocket-bot product,
a bridge between Voice Link's protocol and ElevenLabs would be needed, and that cannot be written until Voice Link
publishes the protocol.

## 3. Questions to send Voice Link support

1. Does my reseller account include **SIP trunk** service for outbound calls, and can my assigned DID be used as caller ID on it? Please send the SIP domain/proxy, port, transport (UDP/TCP/TLS), authentication method (digest user/password or IP), codecs (G.711 µ/a-law?), and DTMF mode.
2. Is the DID inbound-only, or can it originate outbound calls? Which number series and route is it on (TRAI's 140 series for promotional calls, 160 for service calls, or a normal 10-digit number)?
3. Is a **telemarketer / sender registration** (and DLT-style header/template registration) required for AI-generated promotional calls on your routes, and who holds it: you or me?
4. Do you allow **AI-generated voice** on promotional calls, in writing?
5. Is there an authenticated **outbound call API** (click-to-call)? Please send the reference.
6. For **WebSocket Bots**: the URL scheme, message framing (JSON events, binary audio?), audio format (sample rate, encoding, frame size), authentication, call-control messages (hang-up, transfer), and the events you send my server.
7. Do you send **call status webhooks** (answered, busy, no answer, ended)? Format, signature and retry behaviour?
8. Billing: per-minute rate, minimum pulse, wallet top-up, concurrent-call limit, calls-per-second limit, and whether failed or unanswered calls are billed.
9. Is call **recording** done on your side, and can it be switched off?
10. Do calls from an Indian DID to Indian numbers require the AI platform to be **hosted in India** (ElevenLabs asked the same)?

## 4. How a call works

1. The Super Admin makes a campaign (audience filter, call limit, concurrency, hours), reviews the script and the offer, ticks the review box and **approves** it, then **starts** it.
2. Every 30 minutes (and straight after Start) the dialer takes each running campaign and, for each candidate lead, re-runs `callBlockers()` on fresh data. A call is placed only if **all** hold: emergency stop off; campaign running; valid mobile; not on the do-not-call list (this system's or Gym Intelligence's); in test mode, the number is an authorised test number, otherwise there is a recorded reason it may be called and live mode is on with the three telecom confirmations ticked; the lead is still open; within 09:00–21:00 India time and the campaign's own hours; under the attempt limit and retry gap; under the day's call limit.
3. The call row is created with a unique key `campaign:lead:attempt`, so two workers cannot place the same call. The emergency stop is read once more right before the provider is contacted.
4. FITRON asks ElevenLabs to dial. The call's id and a per-call key are passed to the agent as dynamic variables.
5. During the call the agent uses its tools. Each tool needs the shared header **and** that call's key, validates its input, and only then changes anything. The agent is told a demo is booked only if the answer says `booked: true`.
6. After the call ElevenLabs posts a signed report. FITRON closes the call, stores the transcript (phone numbers and emails removed, deleted after the retention period) and, if the agent never saved a result, makes a **human follow-up** instead of guessing one.

What reaches the CRM lead: a logged call ("AI call · …"), the stage moving forward only (Contacted → Interested → Demo Scheduled; it never moves backwards and never closes a deal as lost), a Follow-up or Demo task for the lead's owner (else a Super Admin), and a notification. A person closes deals; the AI does not.

## 5. ElevenLabs setup

1. Create the agent **FITRON AI Sales Agent**: voice of your choice, language English (add Hindi if wanted), interruptions on.
2. **Agent setup** page in the CRM: paste *First message* and *System prompt*. Define the dynamic variables `gym_name`, `owner_name`, `call_id`, `call_token`.
3. Create the eight server tools (`get_gym_details`, `get_fitron_product_information`, `get_current_offer`, `save_call_disposition`, `schedule_demo`, `request_human_followup`, `record_opt_out`, `end_call`): method POST to `/api/webhooks/calling/tools/<name>`, header `x-fitron-tool-secret: <CALLING_TOOL_SECRET>`, parameters exactly as shown on the page, and **bind `call_id` and `call_token` to the dynamic variables** so the model cannot choose them. Also enable ElevenLabs' built-in end-call action (the `end_call` tool only records why).
4. Post-call webhook: `https://<your domain>/api/webhooks/calling/events`, transcription and call-failure events on; copy its signing secret to `ELEVENLABS_WEBHOOK_SECRET`.
5. Import the SIP trunk number (from Voice Link) as a phone number and attach the agent; copy the agent id and phone-number id to `ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID`. Set `ELEVENLABS_API_KEY` and a random `CALLING_TOOL_SECRET` (24+ characters) in Vercel / `deploy/.env`.
6. Not verified against ElevenLabs' live API schema: the exact field names in the dashboard for tool parameter binding. Follow its current screen; the *behaviour* needed is described above.

## 6. Going live, in order

1. Settings: add **your own number** as an authorised test number and save. **Test call** → your phone rings → talk to the agent, ask for a demo, say "do not call me again".
2. Check Call history, the lead's activity, tasks and the do-not-call list.
3. Only when your telecom registration and route are confirmed in writing: tick the three confirmations, switch mode to Live, set the offer, record permission for the leads to be called (**Permission & do-not-call**), create a small campaign (a few leads), approve and start it, watch it.

## 7. Compliance (not legal advice)

* Being **publicly listed does not authorise a sales call**. This system will not call a number without a recorded basis (enquiry, existing customer, opt-in). Gym Intelligence leads therefore cannot be called until someone records one.
* India's telecom rules (TRAI's Telecom Commercial Communications Customer Preference Regulations 2018 and amendments, including the 2025 and 2026 amendments) require sender and telemarketer registration, registered headers/templates, Do-Not-Disturb preference checks and consent handling, and restrict promotional calls to a daytime window (commonly stated as 9 am–9 pm). The press releases were found but their provisions could not be read here, and how the rules apply to AI-generated calls is **not confirmed**. Get written confirmation from Voice Link and your telecom adviser. The three checkboxes record *your* confirmation; FITRON cannot verify them.
* The agent says it is an AI at the start. It stops at "do not call", records it in the call, and the number is blocked everywhere at once, including Gym Intelligence.
* Removing a number from the do-not-call list needs a written reason (10+ characters) and is audited.
* Recording: ElevenLabs may record audio under its own settings; FITRON stores no audio, only a scrubbed transcript for the retention period (default 90 days), then deletes it.

## 8. HTTP API

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/webhooks/calling/tools/<tool>` | header `x-fitron-tool-secret` **and** call key in body | The agent's tools. 400 invalid input, 401 wrong secret/key (same answer for both), 404 unknown tool, 409 call ended, 429 more than 60 a minute for one call |
| `POST /api/webhooks/calling/events` | `ElevenLabs-Signature` HMAC, 30-minute tolerance | Post-call report. 401 forged/stale, 400 malformed, 200 otherwise (also for calls that are not ours) |
| `GET/POST /api/jobs/calls` | `Authorization: Bearer $CRON_SECRET` | Place the next calls, close silent calls (45 min), delete old transcripts |

Everything in the Super Admin pages (campaigns, settings, emergency stop, do-not-call, test call) runs as server actions that check `calling.manage` on the server and write the audit trail (`/crm/audit?kind=calling`).

## 9. Reliability and security

Idempotency by unique key; webhook signature and timestamp; per-call tool keys derived from a server secret (a call's key cannot act on another call); input validation (zod) on every tool; secrets only in server environment; transcripts scrubbed; emergency stop re-read before dialling; provider timeouts (20 s); controlled retries (attempt limit and gap, never an immediate redial); row-level security on every table; structured logs without call content.

**Emergency stop** cancels queued calls and pauses campaigns, and no new call can start. A call **already connected** is not cut off, because no documented way to do that from FITRON was found. The agent ends it on its own, and the Super Admin can hang up from the provider's console.

**Rollback**: stop all campaigns, turn on the emergency stop, then the migration's last lines show the `DROP TABLE` statement. The module touches no other table's structure (it only reads leads and writes ordinary CRM activity, task, notification and audit rows).

## 10. Verification report

Automated, run on the build environment's Postgres with a **fake provider**: 29 rule tests, 25 database tests, 7 HTTP route tests. They prove, among other things: no call without a recorded basis; a suppressed number is never dialled; a duplicate call request creates one call; the emergency stop blocks, pauses and cancels; test mode dials only authorised numbers; hours are enforced even if a campaign asks for more; concurrency and call limits; completion of a campaign; a wrong or another call's key is refused; a demo is booked only on success and writes the stage, task, activity and notification; impossible times and full slots get real alternatives; an opt-out is enforced at once and cannot be undone by a later answer; forged, stale and tampered webhooks are refused; a conversation without a saved result becomes a human follow-up; transcripts are scrubbed and deleted on time; the dashboard shows no invented cost. All Super Admin pages open without errors and pass an automated accessibility check in dark and light themes.

| # | Required test | Status |
| --- | --- | --- |
| 1 | Validate the Voice Link integration | **Not run.** No credentials; the protocol is undocumented (§2) |
| 2 | Outbound call to an authorised test number | **Not run.** Needs §5 and a SIP trunk |
| 3 | Two-way audio | **Not run** |
| 4 | Agent listens and responds | **Not run** |
| 5 | Interruptions, unclear speech | **Not run**; behaviour is set in the agent's prompt and ElevenLabs settings |
| 6 | Busy, unanswered, rejected, failed | **Logic tested with simulated reports**; not with real calls |
| 7 | CRM updates | **Tested** (database tests) |
| 8 | Demo booking | **Tested** (database tests) |
| 9 | Opt-out enforcement | **Tested** |
| 10 | Duplicate-call protection | **Tested** (two concurrent requests, one call) |
| 11 | Emergency termination | **Tested** for new and queued calls; a connected call is not cut (§9) |
| 12 | Billing and recording behaviour | **Not run**; cost is shown only when the provider reports one, and it is not stored today |

The definition of done (a real call to an authorised test phone through your Voice Link number, a demo request, the outcome in the CRM) **has not been met and cannot be until the dependencies below are in place.**

## 11. Remaining dependencies

1. Voice Link: SIP trunk credentials for the DID (or the published WebSocket protocol), written confirmation that the route allows AI promotional calls, any registration it needs.
2. ElevenLabs: an India-resident workspace if required, the agent created per §5, API key, phone-number id, webhook secret.
3. Telecom: your registration/consent position confirmed by a person who can attest it.
4. A real consent basis recorded for every lead that will be called.
5. Call cost: ElevenLabs' report cost unit is not documented to us, so none is shown; use the provider's invoice.
