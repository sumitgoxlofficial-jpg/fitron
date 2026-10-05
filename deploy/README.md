# Put FITRON live on a free server

FITRON is one product at **fitron.in** with three parts, all served by this one app and one database:

| Part | Where | Who uses it |
|---|---|---|
| **Website** | `fitron.in` | Visitors: the landing page with pricing, free-trial sign-up, contact form and policies |
| **AI Trainer** (AI coach) | `fitron.in/trainer` (the design is in `prototype/ai-trainer/`) | Gym members: workout and Indian meal plans, a 24/7 AI coach, habits and progress, from ₹299 a month |
| **Gym Accounting** | `fitron.in/login`, then `/dashboard` | Gym owners and staff: members, renewals, GST invoices, payments, expenses, P&L, reports and Fitron AI, from ₹999 a month |

Gyms sign up themselves from the website (`fitron.in/signup?plan=starter`, `professional` or `enterprise`), confirm their email, and get a 7-day free trial. They pay FITRON by scanning your UPI QR and entering the UTR, and you confirm it (step 9).

This guide sets it all up on an **Oracle Cloud "Always Free"** server. The server is free with no time limit, and it can easily handle 100 staff and thousands of members. You get:

- the website, the AI Trainer and Gym Accounting, served over HTTPS with automatic certificates
- the Postgres database
- daily reminders and other jobs at 06:30 India time
- a backup every night at 02:00

It takes about 30 minutes. You only type commands in steps 5 to 7.

## 1. Create the Oracle Cloud account

1. Go to <https://www.oracle.com/cloud/free/> and sign up.
2. Pick **India South (Hyderabad)** or **India West (Mumbai)** as your home region. You can't change it later.
3. Oracle checks your card. It stays on the free tier and doesn't charge you unless you choose to upgrade.

## 2. Create the server

In the Oracle console, go to **Compute › Instances › Create instance**.

- **Image:** Canonical Ubuntu 24.04.
- **Shape:** Ampere, `VM.Standard.A1.Flex`, with 2 OCPU and 12 GB memory. That's well inside the free allowance of 4 OCPU and 24 GB.
- **Networking:** leave the defaults, and make sure "Assign a public IPv4 address" is on.
- **SSH keys:** choose "Generate a key pair for me" and **download the private key**. You need it to log in.
- **Boot volume:** 100 GB (up to 200 GB is free).

Press **Create**. When it's running, note its **Public IP address**.

> If it says **"Out of capacity"**, try another *availability domain* in the same form, or try again later. Free Ampere servers are in demand.

## 3. Let web traffic in

Go to **Networking › Virtual cloud networks**, then your network, then **Security Lists › Default Security List › Add Ingress Rules**. Add two rules:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

## 4. Point a web address at the server

**For fitron.in:** at the registrar where you bought fitron.in, open its DNS settings and add two records:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| `A` | `@` (some registrars want it blank or `fitron.in`) | the server's public IP | 600 or the lowest offered |
| `A` | `www` | the server's public IP | 600 or the lowest offered |

Delete any other `A`, `AAAA` or `CNAME` records for `@` and `www` first (registrars often add a "parking" record). Leave `MX` and `TXT` records alone: they're for email. When the install script asks for the domain, type `fitron.in`. The landing page is then at `https://fitron.in`, staff sign in at `https://fitron.in/login`, and `www.fitron.in` redirects to `fitron.in`.

Other options:

- **Another domain** (about ₹800 a year from any registrar). Add an **A record**, for example `app` pointing to the server's public IP. That gives you `app.yourgym.in`.
- **Free:** sign in at <https://www.duckdns.org>, create a name such as `yourgym`, and set its IP to the server's public IP. That gives you `yourgym.duckdns.org`.

New records take from a few minutes to a few hours to work. Check with `nslookup fitron.in`: it should print the server's IP before you run the install in step 7.

## 5. Log in to the server

On Windows, use PowerShell. On Mac, use Terminal.

```bash
ssh -i path/to/the-downloaded-key.key ubuntu@YOUR_SERVER_IP
```

If it complains about the key's permissions on Mac or Linux, run `chmod 600 path/to/the-downloaded-key.key` first.

## 6. Get the code

The repository is private, so the server needs its own read-only key:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. On GitHub, open the repository, go to **Settings › Deploy keys › Add deploy key**, and paste it. Leave "Allow write access" **off**. Then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone git@github.com:sumitgoxlofficial-jpg/fitron.git
cd fitron
```

## 7. Install

```bash
bash deploy/install.sh
```

The script:

- installs Docker and opens the server's firewall
- asks for your web address
- asks for your UPI ID (printed under your QR) and the email you'll confirm payments with
- generates the database password and secret keys
- builds and starts everything

The first build takes 5 to 10 minutes. At the end it asks for your gym name and owner login. Use the same email you gave for confirming payments: that login opens the payments page in step 9.

Open `https://your-address` to see the website, and `https://your-address/login` to sign in. 🎉

## 8. Switch on the real services

Until you add their keys, everything runs in **demo mode**: nothing is charged and nothing is sent. To add keys, run the command below on the server. Fill in only what you use, then save with Ctrl+O, Enter and Ctrl+X.

```bash
nano deploy/.env
```

| What | Settings | Also set up |
|---|---|---|
| WhatsApp (official) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | In Meta: webhook `https://your-address/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN` from the file |
| UPI Autopay (your gym's Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook `https://your-address/api/webhooks/razorpay` |
| **Payments to FITRON** (your UPI QR) | `FITRON_UPI_ID` (the UPI ID printed under your QR, e.g. `fitron@okaxis`), `FITRON_UPI_NAME` (name shown in the payer's app), `FITRON_ADMIN_EMAILS` (your login email; several are comma separated). The installer fills in the UPI ID and email you typed | Nothing else. See step 9 |
| Your details on FITRON's invoices to gyms, and on the website's Contact page | `FITRON_LEGAL_NAME`, `FITRON_GSTIN`, `FITRON_ADDRESS` | Leave `FITRON_GSTIN` empty if you're not GST-registered yet. The Contact page shows your registered business name, address and GSTIN once the address or GSTIN is set (payment providers and Indian consumer rules usually expect them on the website) |
| **Sign in with Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | See "Google sign-in" below. Until both are set, the Google button stays hidden and email + password still work |
| Fitron AI and the AI Trainer's coach | `ANTHROPIC_API_KEY` | from console.anthropic.com |
| Email (sign-up confirmation, password reset, payment emails, website enquiries) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `ENQUIRY_TO` | Verify fitron.in with your email provider (it gives you DNS records to add). Without email, new sign-ups are trusted without a confirmation link and password reset can't send its link |
| Documents in the cloud (optional) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | e.g. a Cloudflare R2 bucket (free up to 10 GB); otherwise they're kept on the server |

Then apply them:

```bash
bash deploy/update.sh
```

Never paste these keys into chat or email. They belong only in this file on the server. (`FITRON_UPI_ID` isn't secret: it's on your QR.)

You don't need to set `APP_URL`: it's set from your domain automatically. FITRON's own Razorpay settings (`FITRON_RAZORPAY_*`) are optional and only used if `FITRON_UPI_ID` is empty.

### Google sign-in

1. Open <https://console.cloud.google.com/>, create a project (for example "FITRON") and select it.
2. Go to **APIs & Services › OAuth consent screen**. Pick **External**, app name **FITRON**, your support email, and add `fitron.in` under authorised domains. Add the links to `https://fitron.in/privacy` and `https://fitron.in/terms`. Then **Publish app** so anyone with a Google account can sign in.
3. Go to **APIs & Services › Credentials › Create credentials › OAuth client ID**. Pick **Web application**.
4. Under **Authorised redirect URIs** add exactly `https://fitron.in/auth/google/callback` (use your own domain if it's different).
5. Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `deploy/.env`, then run `bash deploy/update.sh`.

How it behaves: staff whose email is already a FITRON login sign straight in. A new gym owner can press **Sign up with Google** on the sign-up page; Google confirms the email, so no confirmation link is sent and no password is needed (they can set one later with "Forgot your password?"). A Google account with no FITRON login is told to ask their gym's owner to add them.

## 9. Confirm UPI payments from gyms and AI Trainer members

When a gym pays you, this is what happens:

1. In **Settings › Plan & billing**, the gym picks a plan (or an extra branch) and monthly or yearly.
2. FITRON shows a QR for your UPI ID with the exact amount (GST included) and a reference such as `FIT-AB12CD34`. On a phone, "open your UPI app" fills everything in.
3. The gym pays, then types the 12-digit **UTR** from their UPI app. One UTR can only be used once.
4. You get an email ("UPI payment to check") at each address in `FITRON_ADMIN_EMAILS`. The gym keeps working while you check.
5. Sign in, open `https://your-address/fitron-admin` (also linked from Settings › Plan & billing), find that UTR and amount in your bank or UPI app, and press **Money received**. If it isn't there, type why and press **Reject**.

Confirming switches the gym to the plan at once, issues FITRON's invoice, and emails the gym. Rejecting emails the gym the reason so they can check and pay again.

**AI Trainer members** (the app at `https://your-address/trainer`) pay the same way: they pick AI Pro or AI Premium, monthly or yearly, scan the QR (reference like `FTR-AB12CD34`), and type the UTR. Their payments are listed on the same `/fitron-admin` page under **AI Trainer members waiting**. Confirming starts their plan the day after their free trial or current paid period ends, and emails them. A UTR used by a gym can't be used by a member, and the other way round.

Plans and limits (from the pricing page): Starter is up to 100 active members and one branch, Professional up to 300 and one branch, Enterprise has no member limit and 3 branches, and more branches cost ₹499 a month. After a trial or paid period ends there are 7 days' grace, then the gym can still see everything but can't add members or invoices until it pays. Gyms you set up by hand with `npm run setup` aren't on a trial and have no limits.

## Door devices (ZKTeco / eSSL)

On the device, open **Menu › Comm. › Cloud Server Setting**. Set the server address to your web address and the port to **80**, then restart the device. Add its serial number in Fitron under **Settings › Door devices**.

## Everyday care

- **Updates:** `cd ~/fitron && bash deploy/update.sh`. This gets the latest version and applies any database changes.
- **Backups:** saved nightly in `~/fitron/deploy/backups` and kept for 14 days. Copy them off the server now and then, for example from your computer:
  `scp -i key ubuntu@YOUR_SERVER_IP:fitron/deploy/backups/*.dump .`
  For extra safety, turn on a free boot-volume backup in Oracle under **Block Storage › Boot Volumes › Backups**.
- **Restore a backup:** `bash deploy/restore.sh deploy/backups/fitron-YYYYMMDD-HHMM.dump`
- **See what's running:** `cd ~/fitron/deploy && docker compose ps`
- **See errors:** `cd ~/fitron/deploy && docker compose logs --tail 100 app`
- **Find one error:** when something goes wrong, the page shows a short **reference** (and every response carries an `X-Request-Id` header). Search the log for it: `docker compose logs app | grep REFERENCE`. Each error is one JSON line with the page, the kind of error and the first lines of where it happened; `grep request.error` lists them all and `grep client.error` lists the ones that happened in a browser.
- **Get an email when something breaks:** set `ERROR_ALERT_TO` in `deploy/.env` (the installer sets it to your admin email) and set up SMTP as described above. You get at most one email per kind of error per hour, and ten an hour in all. Without SMTP the errors are still in the log. Run `docker compose up -d` after changing `.env`.
- **Health check** for an uptime monitor such as UptimeRobot (free): `https://your-address/api/health`

## How much it can handle

A 2-core, 12 GB server runs Fitron comfortably for 100 staff using it at the same time, and for tens of thousands of members. When you outgrow it, raise the server to 4 cores and 24 GB in Oracle. That's still free.
