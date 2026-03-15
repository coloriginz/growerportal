import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { isTest } from "@/lib/env";
import { prisma } from "@/lib/db";

// Cache the Ethereal transport so it's not recreated every time
let cachedEtherealTransport: Transporter | null = null;

interface TestEmailConfig {
  mode: "ethereal" | "redirect";
  redirectEmail: string | null;
}

async function getTestEmailConfig(): Promise<TestEmailConfig> {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ["test_email_mode", "test_email_redirect"] } },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    return {
      mode: map.test_email_mode === "redirect" ? "redirect" : "ethereal",
      redirectEmail: map.test_email_redirect || null,
    };
  } catch {
    return { mode: "ethereal", redirectEmail: null };
  }
}

function getResendTransport(): Transporter {
  return nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: {
      user: "resend",
      pass: process.env.RESEND_API_KEY,
    },
  });
}

async function getEtherealTransport(): Promise<Transporter> {
  if (cachedEtherealTransport) return cachedEtherealTransport;

  const testAccount = await nodemailer.createTestAccount();
  cachedEtherealTransport = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  return cachedEtherealTransport;
}

async function getTransport(): Promise<{ transport: Transporter; useEthereal: boolean; redirectTo?: string }> {
  if (!isTest) {
    return { transport: getResendTransport(), useEthereal: false };
  }

  const config = await getTestEmailConfig();

  if (config.mode === "redirect" && config.redirectEmail) {
    // Use Resend but redirect all mail to the configured address
    return { transport: getResendTransport(), useEthereal: false, redirectTo: config.redirectEmail };
  }

  // Default: Ethereal
  const transport = await getEtherealTransport();
  return { transport, useEthereal: true };
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: nodemailer.SendMailOptions["attachments"];
}

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: SendEmailOptions): Promise<SMTPTransport.SentMessageInfo> {
  const { transport, useEthereal, redirectTo } = await getTransport();

  const from = useEthereal
    ? '"Coloriginz Grower Portal" <test@ethereal.email>'
    : `"Coloriginz Grower Portal" <${process.env.EMAIL_FROM || "noreply@coloriginz.com"}>`;

  // In redirect mode, override the recipient
  const actualTo = redirectTo || to;

  const info = await transport.sendMail({
    from,
    to: actualTo,
    subject: redirectTo ? `[→ ${to}] ${subject}` : subject,
    html,
    attachments,
  });

  if (useEthereal) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log("[Email] Ethereal preview URL:", previewUrl);
  } else if (redirectTo) {
    console.log(`[Email] Redirected mail for ${to} → ${redirectTo}`);
  }

  return info;
}
