import "server-only";
import nodemailer from "nodemailer";
import { log } from "@/lib/log";

// Outgoing email over SMTP (any provider: Amazon SES, Zoho, Brevo, Gmail Workspace…).
// Without SMTP_HOST, mail is logged instead of sent, like the other integrations' demo mode.

export const emailReady = () => !!process.env.SMTP_HOST?.trim();

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
function smtp() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return transport;
}

export async function sendEmail(mail: { to: string; subject: string; text: string; replyTo?: string }) {
  if (!emailReady()) {
    log.info("email.demo", { to: mail.to, subject: mail.subject });
    return { sent: false as const };
  }
  await smtp().sendMail({ from: process.env.MAIL_FROM || "FITRON <hello@fitron.in>", ...mail });
  return { sent: true as const };
}
