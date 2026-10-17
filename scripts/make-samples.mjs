// Renders the demo documents in public/samples with Chromium.
// Run: node scripts/make-samples.mjs  (needs playwright; dates are relative to today)
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }

const out = path.join(process.cwd(), 'public', 'samples');
const d = (days) => new Date(Date.now() + days * 864e5).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const short = (days) => new Date(Date.now() + days * 864e5).toLocaleDateString('en-US');

const cert = ({ org, title, name, course, date, extra = '', seal = '#1d5a46' }) => `
<div style="width:900px;height:620px;background:#fffdf6;border:14px double ${seal};box-sizing:border-box;padding:48px 60px;font-family:Georgia,serif;color:#222;text-align:center;position:relative">
  <div style="font-size:20px;letter-spacing:4px;text-transform:uppercase;color:${seal}">${org}</div>
  <div style="font-size:44px;margin:28px 0 10px">${title}</div>
  <div style="font-size:18px;font-style:italic">This certifies that</div>
  <div style="font-size:40px;margin:14px 0;border-bottom:1px solid #999;display:inline-block;padding:0 40px">${name}</div>
  <div style="font-size:18px">has successfully completed</div>
  <div style="font-size:24px;font-weight:bold;margin:10px 0">${course}</div>
  <div style="font-size:18px">Completed on ${date}</div>
  ${extra}
  <div style="position:absolute;bottom:44px;left:70px;font-size:15px;border-top:1px solid #333;padding-top:6px;width:220px">Program Director</div>
  <div style="position:absolute;bottom:30px;right:70px;width:96px;height:96px;border-radius:50%;background:${seal};color:#fff;display:grid;place-items:center;font-size:12px;letter-spacing:1px">CERTIFIED</div>
</div>`;

const pages = {
  'training-cert-maria.png': cert({ org: 'Golden State Caregiver Academy', title: 'Certificate of Completion', name: 'Maria Lopez', course: 'Home Care Aide Entry-Level Training', date: d(-12) }),
  'annual-training-ana.png': cert({ org: 'CareSkills Online', title: 'Certificate of Completion', name: 'Ana Reyes', course: 'Annual Home Care Aide Training', date: d(-5), extra: '<div style="font-size:18px;margin-top:8px">Total instruction: <b>5.0 hours</b></div>', seal: '#2a52b5' }),
  'training-transcript-maria.png': `
<div style="width:900px;height:620px;background:#fff;box-sizing:border-box;padding:50px 60px;font-family:Arial,sans-serif;color:#222">
  <div style="font-size:22px;font-weight:bold;color:#1d5a46">Golden State Caregiver Academy</div>
  <div style="font-size:14px;color:#555">Official Training Transcript</div>
  <hr style="margin:20px 0"/>
  <div style="font-size:16px">Student: <b>Maria Lopez</b></div>
  <div style="font-size:16px;margin-top:6px">Program: Home Care Aide Entry-Level Training</div>
  <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:15px">
    <tr style="background:#eef3ef"><th style="text-align:left;padding:8px">Module</th><th style="text-align:left;padding:8px">Date</th><th style="text-align:right;padding:8px">Hours</th></tr>
    <tr><td style="padding:8px">Safety and emergency procedures</td><td style="padding:8px">${short(-13)}</td><td style="padding:8px;text-align:right">2.0</td></tr>
    <tr><td style="padding:8px">Core competencies and client rights</td><td style="padding:8px">${short(-12)}</td><td style="padding:8px;text-align:right">3.0</td></tr>
    <tr style="border-top:2px solid #333"><td style="padding:8px"><b>Total</b></td><td></td><td style="padding:8px;text-align:right"><b>5.0 hours</b></td></tr>
  </table>
  <div style="margin-top:40px;font-size:13px;color:#555">Issued ${d(-11)} · Registrar's office</div>
</div>`,
  'tb-result-james.png': `
<div style="width:900px;height:620px;background:#fff;box-sizing:border-box;padding:46px 60px;font-family:Arial,sans-serif;color:#222">
  <div style="font-size:24px;font-weight:bold">Pasadena Family Clinic</div>
  <div style="font-size:13px;color:#555">1200 E Colorado Blvd · Pasadena, CA</div>
  <div style="font-size:20px;margin-top:26px;font-weight:bold">Tuberculosis Screening Result</div>
  <div style="margin-top:20px;font-size:17px;line-height:34px">
    Patient: <b>James Chen</b><br/>Test type: Tuberculin skin test (TST)<br/>Date placed: ${d(-5)}<br/>Date read: ${d(-3)}<br/>Induration: 0 mm<br/>Result: <b>NEGATIVE</b>
  </div>
  <div style="margin-top:36px;font-size:14px">Read by: R. Alvarez, RN</div>
</div>`,
  'tb-result-david.png': `
<div style="width:900px;height:620px;background:#fbfaf4;box-sizing:border-box;padding:46px 60px;font-family:Arial,sans-serif;color:#222">
  <div style="font-size:24px;font-weight:bold">Valley Community Clinic</div>
  <div style="font-size:20px;margin-top:24px;font-weight:bold">TB Test Record</div>
  <div style="margin-top:20px;font-size:17px;line-height:36px">
    Name: <b>David Kim</b><br/>Test: TST (Mantoux)<br/>Date read: ${d(-6)}<br/>
    Result: <span style="font-family:'Comic Sans MS','Segoe Script',cursive;font-size:24px;color:#234;transform:rotate(-4deg);display:inline-block">neg.</span>
  </div>
  <div style="margin-top:30px;font-family:'Comic Sans MS',cursive;font-size:18px;color:#345">J.P.</div>
</div>`,
  'hca-card-luis.png': `
<div style="width:900px;height:560px;background:#e8eef6;box-sizing:border-box;padding:40px;display:grid;place-items:center">
  <div style="width:760px;height:440px;border-radius:24px;background:#fff;box-shadow:0 8px 24px #0003;padding:36px 44px;box-sizing:border-box;font-family:Arial,sans-serif;color:#1b2b44">
    <div style="font-size:14px;letter-spacing:2px;color:#2a52b5">STATE OF CALIFORNIA · HOME CARE SERVICES BUREAU</div>
    <div style="font-size:30px;font-weight:bold;margin-top:14px">Home Care Aide Registration</div>
    <div style="margin-top:28px;font-size:20px;line-height:40px">Name: <b>Luis Hernández</b><br/>Registration No.: <b>HCA 4417-2290</b><br/>Status: Active<br/>Expires: <b>${d(700)}</b></div>
  </div>
</div>`,
};
// Grace Okafor: a complete, audit-ready personnel file for the demo (see seedDb)
pages['hca-card-grace.png'] = pages['hca-card-luis.png'].replace('Luis Hernández', 'Grace Okafor').replace('HCA 4417-2290', 'HCA DEMO1005');
pages['tb-result-grace.png'] = pages['tb-result-james.png'].replace('Pasadena Family Clinic', 'Lakeside Family Clinic').replace('James Chen', 'Grace Okafor');
pages['training-cert-grace.png'] = cert({ org: 'Golden State Caregiver Academy', title: 'Certificate of Completion', name: 'Grace Okafor', course: 'Home Care Aide Entry-Level Training', date: d(-880), extra: '<div style="font-size:18px;margin-top:8px">Total instruction: <b>6.0 hours</b></div>' });
pages['annual-training-grace.png'] = cert({ org: 'CareSkills Online', title: 'Certificate of Completion', name: 'Grace Okafor', course: 'Annual Home Care Aide Training', date: d(-30), extra: '<div style="font-size:18px;margin-top:8px">Total instruction: <b>5.0 hours</b></div>', seal: '#2a52b5' });
pages['hca-blurry.png'] = `<div style="filter:blur(7px) brightness(1.05);transform:rotate(-7deg) scale(1.08)">${pages['hca-card-luis.png']}</div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
// ONLY=grace re-renders just the files whose name contains it, so the other demo images stay byte-identical
for (const [file, html] of Object.entries(pages)) {
  if (process.env.ONLY && !file.includes(process.env.ONLY)) continue;
  await page.setContent(`<html><body style="margin:0;background:#ddd">${html}</body></html>`);
  await page.screenshot({ path: path.join(out, file), clip: { x: 0, y: 0, width: 900, height: file.startsWith('hca') ? 560 : 620 } });
  console.log('wrote', file);
}
await browser.close();
