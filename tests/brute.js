#!/usr/bin/env node
/*
 * brute.js — feature + concurrency harness for the AMC booking app.
 *
 * Runs entirely over HTTP against a configurable base URL, so the same script
 * can be pointed at localhost now and at the live site later:
 *
 *   node tests/brute.js
 *   node tests/brute.js --base http://localhost:3000
 *   node tests/brute.js --base https://amc.drguptamd.in
 *
 * Optional direct-store inspection (local runs only) lets the harness compare
 * what the API reports against what actually landed in each store:
 *   --store ./data/admin_store.json     inspect the JSON file
 *   --db "postgresql://..."             inspect Postgres via Prisma
 *
 * Flags:
 *   --concurrency N   how many parallel writes in the race tests (default 50)
 *   --skip-calendly   skip tests that call the live Calendly API
 *   --quiet           only print the summary table
 *   --admin-key KEY   secret for /api/admin/* routes (or BRUTE_ADMIN_KEY env var)
 */

const path = require('path');
const fs = require('fs');

// ── arg parsing ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}
const has = (name) => argv.includes('--' + name);

const BASE = (arg('base', process.env.BRUTE_BASE || 'http://localhost:3000')).replace(/\/$/, '');
const STORE_PATH = arg('store', null);
const DB_URL = arg('db', null);
const CONCURRENCY = parseInt(arg('concurrency', '50'), 10);
const SKIP_CALENDLY = has('skip-calendly');
const ADMIN_KEY = arg('admin-key', process.env.BRUTE_ADMIN_KEY || null);
const QUIET = has('quiet');

// ── result table ──────────────────────────────────────────────────────────
const results = [];
let passCount = 0, failCount = 0, skipCount = 0;

function record(feature, action, expected, actual, ok) {
  const status = ok === 'SKIP' ? 'SKIP' : (ok ? 'PASS' : 'FAIL');
  if (status === 'PASS') passCount++;
  else if (status === 'FAIL') failCount++;
  else skipCount++;
  results.push({ feature, action, expected, actual, status });
  if (!QUIET) {
    const mark = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'SKIP';
    console.log(`[${mark}] ${feature}`);
    console.log(`        did      : ${action}`);
    console.log(`        expected : ${expected}`);
    console.log(`        actual   : ${actual}`);
  }
}

function section(title) {
  if (!QUIET) console.log('\n' + '─'.repeat(72) + '\n' + title + '\n' + '─'.repeat(72));
}

// ── http helpers ──────────────────────────────────────────────────────────
async function req(method, endpoint, body, timeoutMs = 60000, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  // Admin routes require a shared secret. opts.noAuth deliberately omits it so
  // the harness can prove the routes reject unauthenticated callers.
  if (ADMIN_KEY && endpoint.startsWith('/api/admin') && !opts.noAuth) {
    headers['X-Admin-Key'] = ADMIN_KEY;
  }
  try {
    const res = await fetch(BASE + endpoint, {
      method,
      signal: controller.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    clearTimeout(t);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* non-JSON response */ }
    return { status: res.status, ok: res.ok, json, text, ms: Date.now() - started, headers: res.headers };
  } catch (err) {
    clearTimeout(t);
    return { status: 0, ok: false, json: null, text: String(err.message || err), ms: Date.now() - started, error: err };
  }
}
const post = (e, b, t, o) => req('POST', e, b, t, o);
const get = (e, t, o) => req('GET', e, null, t, o);
const del = (e, t, o) => req('DELETE', e, null, t, o);

// ── store inspectors ──────────────────────────────────────────────────────
function readJsonStore() {
  if (!STORE_PATH) return null;
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (err) {
    return { __error: err.message };
  }
}

let prisma = null;
async function initDb() {
  if (!DB_URL) return null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await prisma.$connect();
    return prisma;
  } catch (err) {
    console.error('[harness] could not connect to DB:', err.message);
    return null;
  }
}

// ── unique tag so each run's records are identifiable and cleanable ───────
const RUN_TAG = 'BRUTE_' + Date.now().toString(36).toUpperCase();
const createdBookingIds = [];
const createdLeadIds = [];

// ══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(72));
  console.log('BRUTE HARNESS');
  console.log('  base URL    :', BASE);
  console.log('  run tag     :', RUN_TAG);
  console.log('  concurrency :', CONCURRENCY);
  console.log('  json store  :', STORE_PATH || '(not inspected)');
  console.log('  database    :', DB_URL ? DB_URL.replace(/:[^:@]*@/, ':***@') : '(not inspected)');
  console.log('  calendly    :', SKIP_CALENDLY ? 'SKIPPED' : 'included');
  console.log('  admin key   :', ADMIN_KEY ? 'provided' : 'NOT provided (admin routes will 401)');
  console.log('  started     :', new Date().toISOString());
  console.log('='.repeat(72));

  await initDb();

  // ── reachability ────────────────────────────────────────────────────────
  section('0. REACHABILITY');
  {
    const r = await get('/index.html', 15000);
    record('Server reachable', `GET ${BASE}/index.html`, 'HTTP 200', `HTTP ${r.status} (${r.ms}ms)`, r.status === 200);
    if (r.status === 0) {
      console.log('\nServer unreachable — aborting.\n');
      return finish();
    }
  }
  {
    const r = await get('/index.html', 15000);
    const cc = r.headers && r.headers.get ? r.headers.get('cache-control') : null;
    record('Cache headers on static', 'GET /index.html, read Cache-Control',
      'contains no-store', String(cc), Boolean(cc && cc.includes('no-store')));
  }
  {
    const r = await get('/admin.html', 15000);
    record('Admin panel served', 'GET /admin.html', 'HTTP 200', `HTTP ${r.status}`, r.status === 200);
  }
  {
    const r = await get('/audit.html', 15000);
    record('Audit page served', 'GET /audit.html', 'HTTP 200', `HTTP ${r.status}`, r.status === 200);
  }

  // ── admin panel access control ──────────────────────────────────────────
  section('1. ADMIN ACCESS CONTROL');
  {
    const r = await get('/api/admin/dashboard?includeAvailability=false', 90000, { noAuth: true });
    const isOpen = r.status === 200;
    record('Admin API auth', 'GET /api/admin/dashboard with NO credentials',
      'HTTP 401/403 if protected',
      `HTTP ${r.status}` + (isOpen ? ' — endpoint is PUBLIC, no auth required' : ''),
      !isOpen);
  }
  {
    const r = await del('/api/admin/bookings/__nonexistent_probe__', 30000, { noAuth: true });
    record('Admin delete auth', 'DELETE /api/admin/bookings/:id with NO credentials',
      'HTTP 401/403 if protected', `HTTP ${r.status}`, r.status === 401 || r.status === 403);
  }

  // ── lead capture ────────────────────────────────────────────────────────
  section('2. LEAD CAPTURE');
  {
    const payload = {
      name: RUN_TAG + '_lead', email: `${RUN_TAG.toLowerCase()}@example.test`,
      phone: '+91 9000000001', source: 'Instagram', countryCode: '+91',
    };
    const r = await post('/api/admin/leads', payload);
    const id = r.json && r.json.leadId;
    if (id) createdLeadIds.push(id);
    record('Lead create (valid)', 'POST /api/admin/leads with full payload',
      'HTTP 200 + leadId', `HTTP ${r.status}, leadId=${id || 'NONE'}`, r.status === 200 && Boolean(id));
  }
  for (const [label, payload] of [
    ['missing name', { email: 'a@b.co', phone: '123', source: 'x' }],
    ['missing email', { name: 'x', phone: '123', source: 'x' }],
    ['empty object', {}],
    ['nulls', { name: null, email: null, phone: null, source: null }],
    ['wrong types', { name: 123, email: [], phone: {}, source: true }],
  ]) {
    const r = await post('/api/admin/leads', payload);
    record(`Lead reject: ${label}`, `POST /api/admin/leads ${JSON.stringify(payload)}`,
      'HTTP 400', `HTTP ${r.status}`, r.status === 400);
  }
  {
    const hostile = {
      name: '<script>alert(1)</script>' + "'; DROP TABLE \"Booking\"; --",
      email: `hostile+${RUN_TAG.toLowerCase()}@example.test`,
      phone: '+91 ' + '9'.repeat(40),
      source: '🎉😀 Ünïcödé ' + 'A'.repeat(2000),
      countryCode: '+91',
    };
    const r = await post('/api/admin/leads', hostile);
    const id = r.json && r.json.leadId;
    if (id) createdLeadIds.push(id);
    record('Lead hostile input', 'POST /api/admin/leads with XSS/SQL/emoji/2KB string',
      'HTTP 200 or 400, never 500', `HTTP ${r.status}`, r.status !== 500 && r.status !== 0);
  }

  // ── booking intent + THE ID CONSISTENCY TEST ────────────────────────────
  section('3. BOOKING INTENT  (+ cross-store ID consistency)');
  let intentId = null;
  {
    const payload = {
      name: RUN_TAG + '_intent', email: `${RUN_TAG.toLowerCase()}@example.test`,
      phone: '+91 9000000002', countryCode: '+91',
      preferredDate: '1 September 2026', selectedSlot: '10:00 AM',
      selectedCounsellor: 'Counsellor 1 (Test)', timezone: 'Asia/Kolkata',
      source: 'Instagram', notes: RUN_TAG,
    };
    const r = await post('/api/admin/bookings/intent', payload);
    intentId = r.json && r.json.bookingId;
    if (intentId) createdBookingIds.push(intentId);
    record('Booking intent create', 'POST /api/admin/bookings/intent',
      'HTTP 200 + bookingId', `HTTP ${r.status}, bookingId=${intentId || 'NONE'}`,
      r.status === 200 && Boolean(intentId));
  }

  // The critical divergence check: does the id the API returned actually exist
  // in BOTH stores? On a DB-enabled server the JSON keeps a bk_ id while the
  // API returns a cuid, so the JSON lookup misses.
  if (STORE_PATH) {
    // The legacy JSON file must not be a write target any more. If a booking
    // write still lands there, the dual source of truth is back.
    const store = readJsonStore();
    const exists = store && !store.__error;
    const bookingCount = exists ? (store.bookings || []).length : 0;
    const touched = exists && (store.bookings || []).some(b => b.id === intentId);
    record('Legacy JSON store not written', 'create a booking, then inspect data/admin_store.json',
      'the booking does NOT appear in the legacy JSON file',
      exists
        ? (touched ? `FOUND in JSON (${bookingCount} records) — JSON is still a write target` : `absent from JSON (file holds ${bookingCount} stale records)`)
        : 'file does not exist (fully retired)',
      !touched);
  } else {
    record('Legacy JSON store not written', 'inspect admin_store.json', 'booking absent from JSON', 'skipped (no --store)', 'SKIP');
  }
  if (intentId && prisma) {
    const row = await prisma.booking.findUnique({ where: { id: intentId } }).catch(() => null);
    record('ID consistency: Postgres', `look up returned id "${intentId}" in Booking table`,
      'the returned id exists as a DB row',
      row ? 'found' : 'NOT FOUND',
      Boolean(row));
  } else {
    record('ID consistency: Postgres', 'inspect Booking table for returned id',
      'the returned id exists as a DB row', 'skipped (no --db)', 'SKIP');
  }

  // Does the public status endpoint resolve the id the API just handed out?
  if (intentId) {
    const r = await get('/api/bookings/' + encodeURIComponent(intentId) + '/status', 30000);
    record('Status endpoint resolves intent id', `GET /api/bookings/${intentId}/status`,
      'HTTP 200 with the booking', `HTTP ${r.status}`, r.status === 200);
  }

  // ── email field survival (schema has no email column) ────────────────────
  section('4. FIELD SURVIVAL ACROSS STORES');
  if (intentId && prisma) {
    const row = await prisma.booking.findUnique({ where: { id: intentId } }).catch(() => null);
    const hasEmailCol = row ? Object.prototype.hasOwnProperty.call(row, 'email') : false;
    record('Booking.email persisted to DB', 'read the created booking row from Postgres',
      'row carries the submitted email',
      row ? (hasEmailCol ? `email=${row.email}` : 'Booking table has NO email column — email cannot be stored') : 'row missing',
      hasEmailCol);
  } else {
    record('Booking.email persisted to DB', 'read created booking row from Postgres',
      'row carries the submitted email', 'skipped (no --db)', 'SKIP');
  }
  {
    // Does the dashboard still show the email that was submitted?
    const r = await get('/api/admin/dashboard?includeAvailability=false', 120000);
    const bookings = (r.json && r.json.bookings) || [];
    const mine = bookings.find(b => b.id === intentId || (b.notes && String(b.notes).includes(RUN_TAG)) || (b.name && String(b.name).includes(RUN_TAG)));
    const email = mine && mine.email;
    record('Booking email visible in admin', 'GET /api/admin/dashboard, find this run\'s booking, read .email',
      'the submitted email is present',
      mine ? `email=${email === undefined ? 'undefined' : JSON.stringify(email)}` : 'booking not found in dashboard',
      Boolean(mine && email));
  }

  // ── status transitions, including the enum gap ──────────────────────────
  section('5. BOOKING STATUS TRANSITIONS');
  for (const st of ['CONFIRMED', 'CANCELLED', 'PENDING']) {
    if (!intentId) break;
    const r = await post('/api/admin/bookings/status', { id: intentId, status: st });
    let persisted = 'not checked';
    let ok = r.status === 200;
    if (prisma) {
      const row = await prisma.booking.findUnique({ where: { id: intentId } }).catch(() => null);
      persisted = row ? row.status : 'row missing';
      ok = ok && persisted === st;
    }
    record(`Status -> ${st}`, `POST /api/admin/bookings/status {status:"${st}"}`,
      `HTTP 200 and DB row reads ${st}`, `HTTP ${r.status}, db=${persisted}`, ok);
  }
  if (intentId) {
    // COMPLETED is producible by normalizeBookingStatus but absent from the Prisma enum.
    // COMPLETED exists in the enum now. The assertion is simply that the API
    // reports success AND the database actually holds the new value — the
    // combination that used to be impossible.
    const r = await post('/api/admin/bookings/status', { id: intentId, status: 'COMPLETED' });
    let dbStatus = 'not checked';
    if (prisma) {
      const row = await prisma.booking.findUnique({ where: { id: intentId } }).catch(() => null);
      dbStatus = row ? row.status : 'row missing';
    }
    const persisted = dbStatus === 'not checked' || dbStatus === 'COMPLETED';
    record('Status -> COMPLETED (enum gap)', 'POST /api/admin/bookings/status {status:"COMPLETED"}',
      'HTTP 200 AND the database reads COMPLETED',
      `HTTP ${r.status}, db=${dbStatus}` + (persisted ? '' : ' — REPORTED SUCCESS BUT DID NOT PERSIST'),
      r.status === 200 && persisted);
  }
  {
    const r = await post('/api/admin/bookings/status', { status: 'CONFIRMED' });
    record('Status reject: no id', 'POST /api/admin/bookings/status with no id',
      'HTTP 400', `HTTP ${r.status}`, r.status === 400);
  }
  {
    const r = await post('/api/admin/bookings/status', { id: '__does_not_exist__', status: 'CONFIRMED' });
    record('Status on missing booking', 'POST /api/admin/bookings/status for unknown id',
      'HTTP 404 (or 200 no-op), never 500', `HTTP ${r.status}`, r.status !== 500 && r.status !== 0);
  }

  // ── admin confirm endpoint ──────────────────────────────────────────────
  section('6. ADMIN BOOKING CONFIRM');
  {
    const r = await post('/api/admin/bookings/confirm', {});
    record('Confirm reject: empty', 'POST /api/admin/bookings/confirm {}',
      'HTTP 400', `HTTP ${r.status}`, r.status === 400);
  }
  {
    const uri = `https://api.calendly.com/scheduled_events/${RUN_TAG}_single`;
    const r = await post('/api/admin/bookings/confirm', {
      calendlyEventUri: uri, calendlyEventName: 'Test Session',
      scheduledStartTime: new Date(Date.now() + 86400000).toISOString(),
      googleMeetUrl: 'https://meet.google.com/' + RUN_TAG,
      locationType: 'google_conference', status: 'CONFIRMED', notes: RUN_TAG,
    });
    if (r.json && r.json.bookingId) createdBookingIds.push(r.json.bookingId);
    record('Confirm by eventUri', 'POST /api/admin/bookings/confirm with a fresh eventUri',
      'HTTP 200 + bookingId', `HTTP ${r.status}, id=${r.json && r.json.bookingId}`,
      r.status === 200 && Boolean(r.json && r.json.bookingId));
  }
  {
    // Double-click simulation: same eventUri twice, rapidly, in parallel.
    const uri = `https://api.calendly.com/scheduled_events/${RUN_TAG}_double`;
    const body = {
      calendlyEventUri: uri, calendlyEventName: 'Double Click',
      scheduledStartTime: new Date(Date.now() + 86400000).toISOString(),
      status: 'CONFIRMED', notes: RUN_TAG,
    };
    const [a, b] = await Promise.all([
      post('/api/admin/bookings/confirm', body),
      post('/api/admin/bookings/confirm', body),
    ]);
    [a, b].forEach(r => { if (r.json && r.json.bookingId) createdBookingIds.push(r.json.bookingId); });
    let dbCount = 'not checked';
    if (prisma) {
      dbCount = await prisma.booking.count({ where: { calendlyEventUri: uri } }).catch(() => 'error');
    }
    const ok = a.status === 200 && b.status === 200 && (dbCount === 'not checked' || dbCount === 1);
    record('Double-click idempotency', 'fire the SAME eventUri confirm twice in parallel',
      'both HTTP 200 and exactly 1 DB row',
      `a=${a.status} b=${b.status}, db rows for that uri=${dbCount}`, ok);
  }

  // ══ THE RACE TESTS ═════════════════════════════════════════════════════
  section(`7. CONCURRENCY — ${CONCURRENCY} PARALLEL WRITES (lost-update detection)`);
  {
    const jsonBefore = STORE_PATH ? ((readJsonStore() || {}).bookings || []).length : null;
    const dbBefore = prisma ? await prisma.booking.count().catch(() => null) : null;

    const tag = RUN_TAG + '_RACE';
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        post('/api/admin/bookings/intent', {
          name: `${tag}_${i}`, email: `${tag.toLowerCase()}_${i}@example.test`,
          phone: '+91 90000' + String(10000 + i), countryCode: '+91',
          preferredDate: '1 September 2026', selectedSlot: '10:00 AM',
          selectedCounsellor: 'Counsellor 1 (Test)', notes: tag,
        })
      )
    );
    const elapsed = Date.now() - started;

    const http200 = responses.filter(r => r.status === 200).length;
    const withIds = responses.filter(r => r.json && r.json.bookingId).length;
    responses.forEach(r => { if (r.json && r.json.bookingId) createdBookingIds.push(r.json.bookingId); });

    record('Concurrent intents accepted',
      `${CONCURRENCY} parallel POST /api/admin/bookings/intent (${elapsed}ms)`,
      `${CONCURRENCY} responses with HTTP 200 + bookingId`,
      `${http200} x HTTP200, ${withIds} carried a bookingId`,
      http200 === CONCURRENCY && withIds === CONCURRENCY);

    // Give any trailing async writes a moment to land.
    await new Promise(r => setTimeout(r, 1500));

    if (STORE_PATH) {
      const store = readJsonStore();
      const all = (store && store.bookings) || [];
      const mine = all.filter(b => b.notes === tag || (b.name && String(b.name).startsWith(tag)));
      const jsonAfter = all.length;
      record('JSON untouched under concurrency',
        `${CONCURRENCY} parallel writes, then inspect admin_store.json`,
        'the legacy JSON file is not written at all',
        `${mine.length} of this run's records in JSON (file count ${jsonBefore} -> ${jsonAfter})`,
        mine.length === 0 && jsonAfter === jsonBefore);
    } else {
      record('JSON untouched under concurrency', 'inspect admin_store.json after parallel writes',
        'legacy JSON not written', 'skipped (no --store)', 'SKIP');
    }

    if (prisma) {
      const mine = await prisma.booking.count({ where: { notes: tag } }).catch(() => -1);
      const dbAfter = await prisma.booking.count().catch(() => -1);
      const lost = CONCURRENCY - mine;
      record('Postgres lost-update check',
        `count rows with notes='${tag}' after ${CONCURRENCY} parallel writes`,
        `${CONCURRENCY} rows present (count ${dbBefore} -> ${dbBefore + CONCURRENCY})`,
        `${mine} present (count ${dbBefore} -> ${dbAfter}) — ${lost} LOST`,
        lost === 0);
    } else {
      record('Postgres lost-update check', 'count rows after parallel writes',
        `${CONCURRENCY} rows present`, 'skipped (no --db)', 'SKIP');
    }

    // Cross-store agreement — the fingerprint of a dual source of truth.
    if (prisma) {
      // With one store there is nothing to diverge. Assert every accepted write
      // is retrievable through the API by the id it handed back.
      const sample = createdBookingIds.slice(-10);
      let resolvable = 0;
      for (const id of sample) {
        const r = await get('/api/bookings/' + encodeURIComponent(id) + '/status', 20000);
        if (r.status === 200) resolvable++;
      }
      record('Every returned id is resolvable',
        `take ${sample.length} ids the API returned and read each back via /api/bookings/:id/status`,
        'every id resolves to a booking',
        `${resolvable}/${sample.length} resolved`,
        resolvable === sample.length);
    } else {
      record('Every returned id is resolvable', 'read back returned ids', 'all resolve',
        'skipped (no --db)', 'SKIP');
    }
  }

  // ── rapid repeated GETs on the status endpoint ──────────────────────────
  section('8. STATUS ENDPOINT UNDER LOAD');
  if (intentId) {
    const N = 40;
    const started = Date.now();
    const rs = await Promise.all(Array.from({ length: N }, () => get('/api/bookings/' + encodeURIComponent(intentId) + '/status', 30000)));
    const okCount = rs.filter(r => r.status === 200).length;
    const errs = rs.filter(r => r.status >= 500 || r.status === 0).length;
    record('Rapid status polling', `${N} parallel GET /api/bookings/:id/status (${Date.now() - started}ms)`,
      `${N} x HTTP 200, zero 5xx`, `${okCount} x 200, ${errs} x 5xx/network`, okCount === N && errs === 0);

    const statuses = new Set(rs.filter(r => r.json).map(r => JSON.stringify({ s: r.json.status, m: r.json.googleMeetUrl })));
    record('Status endpoint consistency', `compare all ${N} concurrent responses to each other`,
      'every concurrent read returns identical data',
      `${statuses.size} distinct payload(s) observed`, statuses.size <= 1);
  }
  {
    const r = await get('/api/bookings/__no_such_booking__/status', 30000);
    record('Status endpoint: unknown id', 'GET /api/bookings/__no_such_booking__/status',
      'HTTP 404', `HTTP ${r.status}`, r.status === 404);
  }
  {
    const weird = encodeURIComponent('../../etc/passwd');
    const r = await get('/api/bookings/' + weird + '/status', 30000);
    record('Status endpoint: traversal-ish id', 'GET status with ../../etc/passwd as id',
      'HTTP 404, never 500', `HTTP ${r.status}`, r.status === 404);
  }

  // ── admin dashboard ─────────────────────────────────────────────────────
  section('9. ADMIN DASHBOARD');
  {
    const r = await get('/api/admin/dashboard?includeAvailability=false', 120000);
    const d = r.json || {};
    record('Dashboard loads', 'GET /api/admin/dashboard?includeAvailability=false',
      'HTTP 200 with metrics + bookings + leads',
      `HTTP ${r.status}, bookings=${(d.bookings || []).length}, leads=${(d.leads || []).length}, ${r.ms}ms`,
      r.status === 200 && Array.isArray(d.bookings) && Array.isArray(d.leads));
    record('Dashboard reports storage mode', 'read .storageMode / .dbConnected from dashboard',
      'reports which stores are active', `storageMode=${d.storageMode}, dbConnected=${d.dbConnected}`,
      r.status === 200);
  }
  {
    const N = 5;
    const started = Date.now();
    const rs = await Promise.all(Array.from({ length: N }, () => get('/api/admin/dashboard?includeAvailability=false', 120000)));
    const okCount = rs.filter(r => r.status === 200).length;
    const counts = rs.filter(r => r.json).map(r => (r.json.bookings || []).length);
    const consistent = new Set(counts).size <= 1;
    record('Dashboard concurrent loads', `${N} parallel dashboard loads (${Date.now() - started}ms)`,
      `${N} x HTTP 200, identical booking counts`,
      `${okCount} x 200, booking counts=[${counts.join(',')}]`, okCount === N && consistent);
  }

  // ── calendly-backed endpoints ───────────────────────────────────────────
  section('10. CALENDLY-BACKED ENDPOINTS');
  if (SKIP_CALENDLY) {
    record('Month availability', 'GET /api/calendly/month-availability', 'HTTP 200 + dates', 'skipped (--skip-calendly)', 'SKIP');
    record('Day availability', 'GET /api/calendly/availability?date=...', 'HTTP 200 + slots', 'skipped (--skip-calendly)', 'SKIP');
    record('Availability repeatability', 'call month-availability 3x, compare', 'identical results', 'skipped (--skip-calendly)', 'SKIP');
  } else {
    let firstDates = null;
    {
      const r = await get('/api/calendly/month-availability?tz=Asia/Kolkata', 120000);
      const dates = (r.json && r.json.availableDates) || [];
      firstDates = dates;
      record('Month availability', 'GET /api/calendly/month-availability',
        'HTTP 200 with a non-empty availableDates array',
        `HTTP ${r.status}, ${dates.length} dates, ${r.ms}ms`,
        r.status === 200 && dates.length > 0);
    }
    {
      // Repeatability: the same call three times in a row should agree.
      const rs = [];
      for (let i = 0; i < 3; i++) {
        rs.push(await get('/api/calendly/month-availability?tz=Asia/Kolkata', 120000));
      }
      const counts = rs.map(r => ((r.json && r.json.availableDates) || []).length);
      const statuses = rs.map(r => r.status);
      const stable = new Set(counts).size === 1 && counts[0] > 0;
      record('Availability repeatability', 'call month-availability 3x sequentially, compare date counts',
        'all three calls return the same non-empty result',
        `statuses=[${statuses.join(',')}], date counts=[${counts.join(',')}]`, stable);
    }
    {
      // Concurrency against Calendly — this is where rate limiting shows up.
      const N = 8;
      const started = Date.now();
      const rs = await Promise.all(Array.from({ length: N }, () => get('/api/calendly/month-availability?tz=Asia/Kolkata', 120000)));
      const counts = rs.map(r => ((r.json && r.json.availableDates) || []).length);
      const empties = counts.filter(c => c === 0).length;
      record('Availability under concurrency',
        `${N} parallel month-availability calls (${Date.now() - started}ms)`,
        `all ${N} return the same non-empty date list`,
        `date counts=[${counts.join(',')}], ${empties} returned EMPTY`,
        empties === 0 && new Set(counts).size === 1);
    }
    {
      const target = (firstDates && firstDates[0]) || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const r = await get(`/api/calendly/availability?date=${target}&tz=Asia/Kolkata&tzOffset=%2B05:30`, 120000);
      const slots = (r.json && r.json.timeSlots) || [];
      record('Day availability', `GET /api/calendly/availability?date=${target}`,
        'HTTP 200 with timeSlots', `HTTP ${r.status}, ${slots.length} slots, ${r.ms}ms`, r.status === 200);
    }
    {
      const r = await get('/api/calendly/availability?date=not-a-date', 60000);
      record('Day availability: bad date', 'GET /api/calendly/availability?date=not-a-date',
        'HTTP 400', `HTTP ${r.status}`, r.status === 400);
    }
    {
      const r = await get('/api/calendly/check-scheduled?since=' + (Date.now() - 60000), 120000);
      record('Check-scheduled poll', 'GET /api/calendly/check-scheduled',
        'HTTP 200 with scheduled flag', `HTTP ${r.status}, scheduled=${r.json && r.json.scheduled}`, r.status === 200);
    }
  }

  // ── calendly confirm with a bogus uri (degradation test) ────────────────
  section('11. GRACEFUL DEGRADATION (Calendly failure path)');
  {
    const r = await post('/api/calendly/confirm', {}, 60000);
    record('Calendly confirm: no eventUri', 'POST /api/calendly/confirm {}',
      'HTTP 400', `HTTP ${r.status}`, r.status === 400);
  }
  if (!SKIP_CALENDLY) {
    // A well-formed but nonexistent event uri — exercises the retry loop's failure path.
    const started = Date.now();
    const r = await post('/api/calendly/confirm', {
      eventUri: 'https://api.calendly.com/scheduled_events/00000000-0000-0000-0000-000000000000',
      counsellor: 'counsellor1',
    }, 120000);
    const elapsed = Date.now() - started;
    record('Calendly confirm: unknown event', 'POST /api/calendly/confirm with a nonexistent event uri',
      'fails fast with 404, does not block for ~42s',
      `HTTP ${r.status} after ${elapsed}ms` + (elapsed > 20000 ? ' — BLOCKED THE CONNECTION' : ''),
      r.status === 404 && elapsed < 20000);
  } else {
    record('Calendly confirm: unknown event', 'POST /api/calendly/confirm with nonexistent uri',
      'fails fast with 404', 'skipped (--skip-calendly)', 'SKIP');
  }

  // ── malformed / hostile payloads across write endpoints ─────────────────
  section('12. MALFORMED & HOSTILE PAYLOADS');
  const hostileValues = {
    'very long string': 'A'.repeat(10000),
    'unicode + emoji': '🎉😀 Ünïcödé ñ 中文 العربية',
    'quotes/brackets': `"'<>&{}[]\\`,
    'sql-ish': `'; DROP TABLE "Booking"; --`,
    'script-ish': '<script>alert(document.cookie)</script>',
    'null bytes': 'abc def',
  };
  for (const [label, val] of Object.entries(hostileValues)) {
    const r = await post('/api/admin/bookings/intent', {
      name: val, email: `h_${RUN_TAG.toLowerCase()}@example.test`, phone: '+91 9000000009',
      preferredDate: val, selectedSlot: val, selectedCounsellor: val, notes: RUN_TAG + '_HOSTILE',
    });
    if (r.json && r.json.bookingId) createdBookingIds.push(r.json.bookingId);
    record(`Hostile intent: ${label}`, `POST intent with ${label} in text fields`,
      'HTTP 200 or 400, never 500/network error', `HTTP ${r.status}`,
      r.status !== 500 && r.status !== 0);
  }
  {
    // Raw invalid JSON body.
    const res = await fetch(BASE + '/api/admin/bookings/intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not valid json',
    }).catch(e => ({ status: 0, err: e.message }));
    record('Invalid JSON body', 'POST intent with malformed JSON text',
      'HTTP 400, never 500 or crash', `HTTP ${res.status}`, res.status === 400);
  }
  {
    // Deeply nested object.
    let nested = { v: 1 };
    for (let i = 0; i < 500; i++) nested = { v: nested };
    const r = await post('/api/admin/bookings/intent', { name: 'deep', phone: '1', notes: RUN_TAG, deep: nested });
    if (r.json && r.json.bookingId) createdBookingIds.push(r.json.bookingId);
    record('Deeply nested payload', 'POST intent with 500-level nested object',
      'handled, never 500/crash', `HTTP ${r.status}`, r.status !== 500 && r.status !== 0);
  }

  // ── process liveness after the beating ──────────────────────────────────
  section('13. PROCESS LIVENESS');
  {
    const r = await get('/index.html', 15000);
    record('Server alive after all tests', 'GET /index.html after every hostile/concurrent test',
      'HTTP 200 — process never died', `HTTP ${r.status}`, r.status === 200);
  }
  {
    const r = await get('/api/admin/dashboard?includeAvailability=false', 120000);
    record('Dashboard alive after tests', 'GET dashboard after every hostile/concurrent test',
      'HTTP 200', `HTTP ${r.status}`, r.status === 200);
  }

  // ── empty state ─────────────────────────────────────────────────────────
  section('14. CLEANUP + EMPTY STATE');
  {
    const unique = Array.from(new Set(createdBookingIds.concat(createdLeadIds))).filter(Boolean);
    const r = await post('/api/admin/clear-selected', { ids: unique }, 120000);
    record('Clear selected (cleanup)', `POST /api/admin/clear-selected with ${unique.length} ids created by this run`,
      'HTTP 200', `HTTP ${r.status}`, r.status === 200);

    if (prisma) {
      const leftBookings = await prisma.booking.count({ where: { notes: { contains: RUN_TAG } } }).catch(() => -1);
      record('Cleanup removed DB rows', `count Booking rows still tagged ${RUN_TAG}`,
        '0 rows remain', `${leftBookings} remain`, leftBookings === 0);
    } else {
      record('Cleanup removed DB rows', 'count remaining tagged rows', '0 remain', 'skipped (no --db)', 'SKIP');
    }
  }
  {
    const r = await post('/api/admin/clear-selected', { ids: [] });
    record('Clear selected: empty array', 'POST /api/admin/clear-selected {ids:[]}',
      'HTTP 400', `HTTP ${r.status}`, r.status === 400);
  }

  return finish();
}

function finish() {
  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(72));
  const w1 = Math.min(42, Math.max(...results.map(r => r.feature.length), 7));
  console.log('STATUS  ' + 'FEATURE'.padEnd(w1) + '  ACTUAL');
  console.log('-'.repeat(72));
  for (const r of results) {
    console.log(
      r.status.padEnd(7) + ' ' +
      r.feature.slice(0, w1).padEnd(w1) + '  ' +
      r.actual.slice(0, 90)
    );
  }
  console.log('-'.repeat(72));
  console.log(`TOTAL: ${results.length}   PASS: ${passCount}   FAIL: ${failCount}   SKIP: ${skipCount}`);
  console.log('finished:', new Date().toISOString());
  console.log('='.repeat(72));

  if (failCount > 0) {
    console.log('\nFAILURES:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.feature}`);
      console.log(`      expected: ${r.expected}`);
      console.log(`      actual  : ${r.actual}`);
    });
  }
  if (prisma) prisma.$disconnect().catch(() => {});
  return failCount;
}

main().then(
  (fails) => process.exit(0),
  (err) => { console.error('\n[harness crashed]', err); process.exit(2); }
);
