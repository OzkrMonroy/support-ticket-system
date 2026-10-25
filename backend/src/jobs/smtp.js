import nodemailer from 'nodemailer';

export function createMailTransport(env = process.env, createTransport = nodemailer.createTransport) {
  const port = Number(env.SMTP_PORT || 465);
  if (!env.SMTP_USER?.trim() || !env.SMTP_APP_PASSWORD?.trim() || !env.EMAIL_FROM?.trim() ||
      !Number.isInteger(port) || ![465, 587].includes(port)) {
    throw new Error('Set SMTP_USER, SMTP_APP_PASSWORD, EMAIL_FROM and SMTP_PORT (465 or 587).');
  }
  return createTransport({ host: env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
    requireTLS: true, auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true });
}
