// Fitron WhatsApp connector: links your WhatsApp by QR (like WhatsApp Web) and sends messages for the Fitron app.
// Run on the gym PC or a small server: `npm install` then `npm start`. Keep it running.
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PORT = +process.env.PORT || 3131;
const KEY = process.env.FITRON_KEY || 'fitron-local';         // default works out of the box on the same PC; set your own when hosting
const HOST = process.env.HOST || (process.env.FITRON_KEY ? '0.0.0.0' : '127.0.0.1'); // default key = only this PC can reach it
const DAILY_CAP = +process.env.DAILY_CAP || 250;
const GAP_MIN = 8000, GAP_MAX = 15000;                         // random gap between messages

let state = 'starting', qrDataUrl = null, me = null, lastError = null, sentToday = 0, day = new Date().toDateString();
const queue = [], results = new Map();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),      // session survives restarts; delete ./session to unlink
  puppeteer: { headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
client.on('qr', async qr => { state = 'qr'; lastError = null; try { qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); } catch (e) { console.error('QR failed', e.message); } console.log('Scan the QR in Fitron › Settings › WhatsApp'); });
client.on('authenticated', () => { state = 'authenticating'; qrDataUrl = null; lastError = null; });
client.on('ready', () => { state = 'ready'; qrDataUrl = null; lastError = null; me = client.info && client.info.wid ? client.info.wid.user : null; console.log('WhatsApp linked:', me); pump(); });
client.on('auth_failure', m => { state = 'starting'; lastError = 'WhatsApp rejected the saved link: ' + m; console.error('Auth failure', m); restart(3000); });
client.on('disconnected', r => { state = 'disconnected'; me = null; lastError = 'Disconnected: ' + r; console.warn('Disconnected:', r); restart(5000); });
client.on('message_ack', (msg, ack) => { const r = results.get(msg.id._serialized); if (r) { const next = ack >= 3 ? 'Read' : ack >= 2 ? 'Delivered' : ack >= 1 ? 'Sent' : ack < 0 ? 'Failed' : null; if (next) { r.status = next; if (next === 'Failed') r.error = 'WhatsApp could not deliver this message'; } } });

// Starting WhatsApp Web can fail (no internet, Chrome missing, a stale session). That must never stop the connector:
// keep the HTTP side up, say why in /status, and try again.
let restarting = false;
const friendly = e => {
  const m = String((e && e.message) || e);
  if (/Could not find (Chrome|Chromium|browser)|Failed to launch|executable/i.test(m)) return 'Chrome could not start. Run npm install again, or set CHROME_PATH to an installed Chrome or Chromium. (' + m.split('\n')[0] + ')';
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TUNNEL|ERR_PROXY|ERR_TIMED_OUT/i.test(m)) return 'This computer cannot reach web.whatsapp.com. Check its internet connection. Retrying every 15 seconds.';
  return m.split('\n')[0];
};
async function start() {
  try { await client.initialize(); }
  catch (e) { state = 'error'; qrDataUrl = null; lastError = friendly(e); console.error('Could not start WhatsApp:', lastError); restart(15000); }
}
function restart(ms) {
  if (restarting) return;
  restarting = true;
  setTimeout(async () => { try { await client.destroy(); } catch (e) {} restarting = false; state = 'starting'; start(); }, ms);
}
process.on('unhandledRejection', e => { console.error('Unhandled:', (e && e.message) || e); });
process.on('uncaughtException', e => { console.error('Uncaught:', (e && e.message) || e); });
start();
setInterval(pump, 60000);   // picks the queue up again after the daily cap resets, or after a reconnect

const toJid = n => { const d = String(n).replace(/\D/g, ''); return (d.length === 10 ? '91' + d : d) + '@c.us'; };
let busy = false;
async function pump() {
  if (busy || state !== 'ready' || !queue.length) return;
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); sentToday = 0; }
  if (sentToday >= DAILY_CAP) return;
  busy = true;
  const job = queue.shift();
  try {
    const jid = toJid(job.to);
    const ok = await client.isRegisteredUser(jid);
    if (!ok) throw new Error('Number is not on WhatsApp');
    let msg;
    if (job.media && job.media.data) msg = await client.sendMessage(jid, new MessageMedia(job.media.mimetype || 'application/pdf', job.media.data, job.media.filename || 'invoice.pdf'), { caption: job.text });
    else msg = await client.sendMessage(jid, job.text);
    sentToday++;
    results.set(job.id, { status: 'Sent', waId: msg.id._serialized });
    results.set(msg.id._serialized, results.get(job.id));
  } catch (e) { results.set(job.id, { status: 'Failed', error: e.message }); }
  busy = false;
  setTimeout(pump, GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
}

const app = express();
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Private-Network', 'true'); next(); }); // Chrome Private Network Access
app.use(cors({ origin: true, allowedHeaders: ['Content-Type', 'x-fitron-key'] }));
app.options('*', (req, res) => res.sendStatus(204));
app.use(express.json({ limit: '15mb', verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
app.post('/autopay/webhook', (req, res, next) => next()); // webhook is called by Razorpay without the Fitron key
app.use((req, res, next) => req.path === '/autopay/webhook' || req.headers['x-fitron-key'] === KEY ? next() : res.status(401).json({ error: 'Wrong connector key' }));
require('./autopay')(app); // UPI Autopay via Razorpay Subscriptions (set RZP_KEY_ID, RZP_KEY_SECRET, RZP_WEBHOOK_SECRET)
app.get('/status', (req, res) => res.json({ state, number: me, queued: queue.length, sentToday, cap: DAILY_CAP, error: state === 'ready' ? null : lastError }));
app.get('/qr', (req, res) => res.json({ state, qr: qrDataUrl }));
app.post('/send', (req, res) => {
  const { id, to, text, media } = req.body || {};
  if (!id || !to || !text) return res.status(400).json({ error: 'id, to and text are required' });
  queue.push({ id, to, text, media }); results.set(id, { status: 'Queued' }); pump();
  res.json({ id, status: 'Queued', position: queue.length });
});
app.post('/results', (req, res) => { const out = {}; (req.body.ids || []).forEach(i => { const r = results.get(i); if (r) out[i] = { status: r.status, error: r.error }; }); res.json(out); });
app.post('/logout', async (req, res) => { try { await client.logout(); } catch (e) {} state = 'starting'; me = null; qrDataUrl = null; lastError = null; restart(1000); res.json({ ok: true }); });
const server = app.listen(PORT, HOST, () => console.log('Fitron WhatsApp connector running on ' + HOST + ':' + PORT + '. Open Fitron › Settings › WhatsApp › Link WhatsApp and scan the QR. Keep this window open.'));
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use: the connector is probably already running in another window. Close that one, or set PORT.' : 'Server error: ' + e.message); process.exit(1); });
