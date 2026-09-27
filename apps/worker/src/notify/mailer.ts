/**
 * The Mailer port. The worker sends every email through it, so tests use a mailer that keeps
 * messages in memory and development uses Mailpit.
 */
import nodemailer from "nodemailer";

export interface Mail {
  to: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** False when email is switched off, so callers leave the work for later. */
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryMailer implements Mailer {
  readonly enabled = true;
  readonly sent: Mail[] = [];
  /** Set to make the next sends fail, as a mail server that is down would. */
  failing = false;
  async send(mail: Mail): Promise<void> {
    if (this.failing) throw new Error("The mail server refused the connection");
    this.sent.push(mail);
  }
}

export class NullMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<void> {}
}

export class SmtpMailer implements Mailer {
  readonly enabled = true;
  readonly #transport: nodemailer.Transporter;
  readonly #from: string;

  constructor(url: string, from: string) {
    this.#transport = nodemailer.createTransport(url, {
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.#from = from;
  }

  async send(mail: Mail): Promise<void> {
    await this.#transport.sendMail({
      from: this.#from,
      to: { name: mail.to.name, address: mail.to.email },
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }

  async close(): Promise<void> {
    this.#transport.close();
  }
}

export function createMailer(config: { SMTP_URL?: string | undefined; MAIL_FROM: string }): Mailer {
  return config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) : new NullMailer();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One plain layout for every email: a heading, the content, and how to stop the emails. */
export function layout(opts: { heading: string; html: string; publicUrl: string }): string {
  return [
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a;font-size:15px;line-height:1.5">`,
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e0;border-radius:8px;padding:24px">`,
    `<h1 style="font-size:19px;margin:0 0 16px">${escapeHtml(opts.heading)}</h1>`,
    opts.html,
    `<p style="margin:24px 0 0;font-size:13px;color:#6b6b66">You can change what is emailed to you in <a href="${escapeHtml(opts.publicUrl)}/notifications" style="color:#6b6b66">Notifications</a>.</p>`,
    `</div></body></html>`,
  ].join("");
}
