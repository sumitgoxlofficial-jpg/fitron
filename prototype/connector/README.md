# Fitron WhatsApp connector

Links the gym's WhatsApp by QR code (like WhatsApp Web) so Fitron can send reminders and invoices automatically. No Meta API key.

## Easiest: gym PC, double-click
1. Copy the `connector` folder to the reception PC.
2. Double-click **Start WhatsApp -Windows-.bat** (Mac: **Start WhatsApp -Mac-.command**). First time it offers to install Node.js, then installs itself (2–3 min).
3. In Fitron on the same PC: Settings › WhatsApp › **Link WhatsApp**. The QR appears straight away; scan it from the gym phone (WhatsApp › Linked devices › Link a device). Done.
Keep the black window open (or minimise it). With the default settings only this PC can use the connector.

No settings are needed on the Fitron server for this: when `WA_CONNECTOR_URL` and `WA_CONNECTOR_KEY` are empty, Fitron looks for the connector at `http://127.0.0.1:3131` with the built-in key `fitron-local`, which is exactly what this start file uses. This works when Fitron runs on the same PC (`npm run dev`, `npm start`). It does **not** work when Fitron is hosted online (Vercel, a server): a server cannot reach the PC's `127.0.0.1`. Then host the connector too (next section) and set `WA_CONNECTOR_URL` and `WA_CONNECTOR_KEY` on the Fitron server.

If Fitron runs in Docker on the same PC, set `WA_CONNECTOR_URL=http://host.docker.internal:3131` and `WA_CONNECTOR_KEY=<the FITRON_KEY the connector was started with>` in `deploy/.env`. The connector only accepts other machines once `FITRON_KEY` is set, so start it with `FITRON_KEY` set.

## Always-on: cloud server (no PC needed)
Deploy this folder to Render (render.yaml included), Railway or any VPS with Docker. Then set two environment variables on the **Fitron server** (on Vercel: Project › Settings › Environment Variables, then redeploy):

```
WA_CONNECTOR_URL=https://<your-connector-host>        (no trailing path)
WA_CONNECTOR_KEY=<the FITRON_KEY Render generated for the connector>
```

Open Fitron › Settings › WhatsApp › **Link WhatsApp**: the QR appears there, and after scanning every staff device just sees "Linked".

## Manual setup (terminal)
1. Install Node.js 18 or newer from nodejs.org.
2. Copy this `connector` folder to the PC, open a terminal in it and run:
   ```
   npm install
   set FITRON_KEY=pick-a-long-secret      (Mac/Linux: export FITRON_KEY=pick-a-long-secret)
   npm start
   ```
3. On the Fitron server set `WA_CONNECTOR_URL=http://localhost:3131` and `WA_CONNECTOR_KEY=pick-a-long-secret` (the same key), then restart Fitron.
4. In Fitron › Settings › WhatsApp › Link WhatsApp the real QR appears. On the gym phone: WhatsApp › Linked devices › Link a device › scan.
5. Keep the terminal running (or install as a service with `pm2 start server.js --name fitron-wa`).

## Notes
- Messages go out one every 8–15 seconds, max 250 a day (`DAILY_CAP`).
- Unlink: press Unlink in Fitron, or delete the `session` folder.
- The phone must come online at least every 14 days.
- Unofficial: WhatsApp may restrict numbers that send bulk messages to people who haven't saved the number. Message only your members.
- Fitron talks to the connector from its server, not from the browser, so the connector must be reachable from wherever Fitron runs. For a Fitron hosted online with the connector on a gym PC, expose the PC over https, e.g. `cloudflared tunnel --url http://localhost:3131`, and use that URL as `WA_CONNECTOR_URL`. Hosting the connector on Render is more reliable.
- The window shows why WhatsApp did not start (no internet, Chrome missing) and keeps retrying; Fitron shows the same reason in the Link WhatsApp dialog. If a message stays "Queued", the connector was probably restarted before it sent it; Fitron marks such messages Failed after 6 hours so they can be sent again.


## UPI Autopay (real recurring debits)
The same connector also runs Fitron's UPI Autopay through **Razorpay Subscriptions**. Set these before starting:

```
RZP_KEY_ID=rzp_live_xxxxxxxx
RZP_KEY_SECRET=xxxxxxxxxxxxxxxx
RZP_WEBHOOK_SECRET=any-long-random-string
```

In the Razorpay dashboard → Webhooks add `https://<your-connector-host>/autopay/webhook` with the secret above and the events
`subscription.authenticated, subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.paused, subscription.resumed, payment.failed`.
Webhooks need a public HTTPS address, so host the connector on Render (or similar), not only on the gym PC.

Then in Fitron → Settings → Integrations & AI → UPI autopay choose **Live (Razorpay)**. Creating a mandate sends the member an authorisation link on WhatsApp; once they approve it in any UPI app, Razorpay charges the plan amount on every renewal date, sends the NPCI pre-debit notice, retries failures, and Fitron records the renewal, invoice and payment automatically.
