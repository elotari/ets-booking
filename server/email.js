const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.FROM_EMAIL      || 'onboarding@resend.dev';
const SEC    = process.env.SECRETARY_EMAIL || '';

const DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatDateAr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${DAY_AR[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

function serviceLabel(s) {
  const map = {
    projector:   'جهاز العرض',
    whiteboard:  'السبورة',
    videoconf:   'مؤتمر مرئي',
    coffee:      'قهوة / ضيافة',
    water:       'مياه',
  };
  return map[s] || s;
}

function row(label, value) {
  return `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e8edf3;color:#555;font-size:14px;width:40%;text-align:right;">${label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e8edf3;font-weight:600;color:#0f2a4a;font-size:14px;text-align:right;">${value || '—'}</td>
    </tr>`;
}

function bookerHtml({ ref, room, date, start_time, end_time, subject, department, employee_id }) {
  const dateAr = formatDateAr(date);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,42,74,.12);">

        <!-- Header -->
        <tr>
          <td style="background:#0f2a4a;padding:36px 32px;text-align:center;">
            <div style="font-size:42px;margin-bottom:8px;">✓</div>
            <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;letter-spacing:.5px;">تم تأكيد حجزك</h1>
            <p style="color:#9bbdd4;margin:8px 0 0;font-size:14px;">رقم المرجع: <strong style="color:#e8a000;">${ref}</strong></p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:32px;">
            <p style="color:#1d5fa8;font-size:16px;margin:0 0 24px;font-weight:600;">تفاصيل الحجز</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e8edf3;border-radius:8px;overflow:hidden;">
              ${row('الغرفة',        room.toUpperCase())}
              ${row('التاريخ',       dateAr)}
              ${row('الوقت',         `${start_time} — ${end_time}`)}
              ${row('الموضوع',       subject)}
              ${row('القسم',         department)}
              ${row('رقم الوظيفي',   employee_id || '—')}
              ${row('REF',           ref)}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f7f9fc;padding:20px 32px;text-align:center;border-top:1px solid #e8edf3;">
            <p style="color:#888;font-size:13px;margin:0;">للاستفسار تواصل مع <strong style="color:#0f2a4a;">مريم</strong> — إدارة المرافق</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function secretaryHtml(booking) {
  const { ref, room, date, start_time, end_time, subject, department, name, employee_id, phone, email, services, notes } = booking;
  const dateAr = formatDateAr(date);
  const servicesParsed = (() => { try { return JSON.parse(services || '[]'); } catch { return []; } })();
  const servicesText = servicesParsed.length ? servicesParsed.map(serviceLabel).join('، ') : '—';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,42,74,.12);">

        <!-- Header -->
        <tr>
          <td style="background:#1d5fa8;padding:28px 32px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">حجز جديد</h1>
            <p style="color:#b8d4f0;margin:6px 0 0;font-size:13px;">رقم المرجع: <strong style="color:#e8a000;">${ref}</strong></p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e8edf3;border-radius:8px;overflow:hidden;">
              ${row('الاسم',        name)}
              ${row('رقم الوظيفي', employee_id || '—')}
              ${row('القسم',       department)}
              ${row('الهاتف',      phone)}
              ${row('البريد',   email)}
              ${row('الغرفة',   room.toUpperCase())}
              ${row('التاريخ',  dateAr)}
              ${row('الوقت',    `${start_time} — ${end_time}`)}
              ${row('الموضوع',  subject)}
              ${row('الخدمات',  servicesText)}
              ${row('ملاحظات',  notes)}
              ${row('REF',      ref)}
            </table>
          </td>
        </tr>

        <tr>
          <td style="background:#f7f9fc;padding:16px 32px;text-align:center;border-top:1px solid #e8edf3;">
            <p style="color:#888;font-size:12px;margin:0;">نظام حجز غرف الاجتماعات — ETS</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendConfirmationEmails(booking) {
  const { email, ref, subject } = booking;
  const sends = [];

  if (email) {
    sends.push(
      resend.emails.send({
        from:    FROM,
        to:      email,
        subject: `تأكيد حجز غرفة الاجتماعات — REF: ${ref}`,
        html:    bookerHtml(booking),
      })
    );
  }

  if (SEC) {
    sends.push(
      resend.emails.send({
        from:    FROM,
        to:      SEC,
        subject: `حجز جديد — ${subject} · ${ref}`,
        html:    secretaryHtml(booking),
      })
    );
  }

  const results = await Promise.allSettled(sends);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[email] send #${i} failed:`, r.reason);
    }
  });
}

module.exports = { sendConfirmationEmails };
