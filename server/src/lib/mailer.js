import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, now } from '../db.js';

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: Number(last.slice(0, 3)), text: buffer });
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function command(socket, line) {
  socket.write(`${line}\r\n`);
  return readResponse(socket);
}

async function smtpSend({ to, subject, body }) {
  const { host, port, secure, user, pass, from } = config.mail;
  let socket;
  if (secure) {
    socket = tls.connect({ host, port, servername: host });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
  } else {
    socket = net.connect({ host, port });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
  }
  socket.setTimeout(20000);
  try {
    let res = await readResponse(socket);
    if (res.code !== 220) throw new Error(`SMTP greeting ${res.code}`);
    res = await command(socket, `EHLO ${config.publicUrl.replace(/^https?:\/\//, '') || 'haonline.local'}`);
    if (res.code !== 250) throw new Error(`SMTP EHLO ${res.code}`);
    if (!secure) {
      res = await command(socket, 'STARTTLS');
      if (res.code !== 220) throw new Error(`SMTP STARTTLS ${res.code}`);
      socket = tls.connect({ socket, servername: host });
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      res = await command(socket, `EHLO ${host}`);
      if (res.code !== 250) throw new Error(`SMTP EHLO/TLS ${res.code}`);
    }
    if (user) {
      res = await command(socket, 'AUTH LOGIN');
      if (res.code !== 334) throw new Error(`SMTP AUTH ${res.code}`);
      res = await command(socket, Buffer.from(user).toString('base64'));
      if (res.code !== 334) throw new Error(`SMTP AUTH user ${res.code}`);
      res = await command(socket, Buffer.from(pass).toString('base64'));
      if (res.code !== 235) throw new Error(`SMTP AUTH failed ${res.code}`);
    }
    res = await command(socket, `MAIL FROM:<${from}>`);
    if (res.code !== 250) throw new Error(`SMTP MAIL FROM ${res.code}`);
    res = await command(socket, `RCPT TO:<${to}>`);
    if (res.code !== 250 && res.code !== 251) throw new Error(`SMTP RCPT ${res.code}`);
    res = await command(socket, 'DATA');
    if (res.code !== 354) throw new Error(`SMTP DATA ${res.code}`);
    const message = [
      `From: HAONLINE <${from}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@haonline>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ].join('\r\n');
    socket.write(`${message}\r\n.\r\n`);
    res = await readResponse(socket);
    if (res.code !== 250) throw new Error(`SMTP message ${res.code}`);
    await command(socket, 'QUIT').catch(() => {});
  } finally {
    socket.destroy();
  }
}

export async function sendMail({ to, subject, body }) {
  const mailId = crypto.randomUUID();
  db.prepare('INSERT INTO email_outbox (id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(mailId, to, subject, body, 'queued', now());
  if (!config.mail.host) {
    db.prepare('UPDATE email_outbox SET status = ? WHERE id = ?').run('logged', mailId);
    if (config.env !== 'production') {
      console.log(`[mail] to=${to} subject="${subject}" (SMTP not configured, stored in email_outbox)`);
    }
    return { id: mailId, delivered: false };
  }
  try {
    await smtpSend({ to, subject, body });
    db.prepare('UPDATE email_outbox SET status = ? WHERE id = ?').run('sent', mailId);
    return { id: mailId, delivered: true };
  } catch (err) {
    db.prepare('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?').run('failed', String(err.message || err), mailId);
    console.error(`[mail] delivery failed: ${err.message}`);
    return { id: mailId, delivered: false, error: err.message };
  }
}

export function verificationEmail(code) {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
    <h1 style="color:#4f46e5">HAONLINE</h1>
    <p>Mã xác minh của bạn là:</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:700">${code}</p>
    <p>Mã có hiệu lực 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
  </div>`;
}
