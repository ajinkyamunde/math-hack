import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv, emailVerificationAvailable } from '../config/environment.js';

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!emailVerificationAvailable()) throw new Error('SMTP is not configured');
  const env = getEnv();
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const env = getEnv();
  const link = `${env.FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Verify your MathHack account',
    text: `Hello ${name},\n\nConfirm your college email for MathHack by opening this link within 24 hours:\n${link}\n\nIf you did not register, ignore this message.`,
  });
}
