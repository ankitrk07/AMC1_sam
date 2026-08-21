const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const SibApiV3Sdk = require('sib-api-v3-sdk');
require('dotenv').config();

// ──────────────────────────────────────────────────────
// Crash visibility
// Node >= 15 terminates on an unhandled rejection. Without these handlers a
// crash is silent and a process-manager restart looks like "it broke for a
// few seconds then fixed itself". Log the full stack, then exit non-zero so
// the supervisor restarts a clean process rather than continuing in an
// undefined state.
// ──────────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('──────── UNHANDLED PROMISE REJECTION ────────');
  console.error('  pid       :', process.pid);
  console.error('  time      :', new Date().toISOString());
  console.error('  reason    :', reason && reason.message ? reason.message : reason);
  console.error('  stack     :', reason && reason.stack ? reason.stack : '(no stack)');
  console.error('  promise   :', promise);
  console.error('─────────────────────────────────────────────');
  process.exit(1);
});

process.on('uncaughtException', (err, origin) => {
  console.error('──────── UNCAUGHT EXCEPTION ────────');
  console.error('  pid       :', process.pid);
  console.error('  time      :', new Date().toISOString());
  console.error('  origin    :', origin);
  console.error('  message   :', err && err.message);
  console.error('  stack     :', err && err.stack ? err.stack : '(no stack)');
  console.error('────────────────────────────────────');
  process.exit(1);
});

// ──────────────────────────────────────────────────────
// Environment validation — fail closed, never silently change mode.
//
// The bug this codebase was built around was DATABASE_URL being absent
// locally: server.js silently fell back to a JSON-only code path, so the
// laptop and the server ran different programs. An absent required variable
// must stop the process, not quietly alter behaviour.
// ──────────────────────────────────────────────────────
const REQUIRED_ENV = [
  { key: 'DATABASE_URL', why: 'PostgreSQL connection string — the single source of truth for leads and bookings' },
  { key: 'ADMIN_API_KEY', why: 'shared secret protecting every /api/admin/* route — without it the admin API would expose every lead' },
];

const OPTIONAL_ENV = [
  { key: 'PORT', why: 'HTTP port (defaults to 3000)' },
  { key: 'CALENDLY_API_TOKEN_1', why: 'Calendly personal access token for counsellor 1' },
  { key: 'CALENDLY_API_TOKEN_2', why: 'Calendly personal access token for counsellor 2' },
  { key: 'CALENDLY_URL_1', why: 'Calendly scheduling URL for counsellor 1' },
  { key: 'CALENDLY_URL_2', why: 'Calendly scheduling URL for counsellor 2' },
  { key: 'CALENDLY_TIMEZONE', why: 'IANA timezone for slot display (defaults to Asia/Kolkata)' },
  { key: 'CALENDLY_TIMEZONE_OFFSET', why: 'UTC offset used to build day ranges (defaults to +05:30)' },
  { key: 'BREVO_API_KEY', why: 'Brevo transactional email key — without it emails are logged only' },
];

function describeEnvValue(key) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return { set: false, note: 'MISSING' };
  if (String(raw).startsWith('your_')) return { set: false, note: 'PLACEHOLDER' };
  return { set: true, note: 'SET' };
}

function validateEnvironment() {
  console.log('──────── ENVIRONMENT CHECK ────────');
  const missing = [];

  for (const { key, why } of REQUIRED_ENV) {
    const { set, note } = describeEnvValue(key);
    console.log(`  [${set ? 'SET    ' : 'MISSING'}] ${key}  — ${why}`);
    if (!set) missing.push({ key, why, note });
  }
  for (const { key, why } of OPTIONAL_ENV) {
    const { set, note } = describeEnvValue(key);
    console.log(`  [${set ? 'SET    ' : note.padEnd(7)}] ${key}  — ${why}`);
  }
  console.log('───────────────────────────────────');

  if (missing.length > 0) {
    console.error('');
    console.error('REFUSING TO START — required environment variables are missing:');
    for (const m of missing) {
      console.error(`  - ${m.key} (${m.note}): ${m.why}`);
    }
    console.error('');
    console.error('Set them in .env (see .env.example for the full list) and start again.');
    console.error('The server deliberately does NOT fall back to a degraded mode: doing so');
    console.error('is what made the laptop and the server run different code paths.');
    console.error('');
    process.exit(1);
  }
}

validateEnvironment();

// ──────────────────────────────────────────────────────
// Brevo (Sendinblue) Transactional Email Client Setup
// ──────────────────────────────────────────────────────
let brevoClient = null;
const BREVO_SENDER = { name: 'AMC by DRG', email: 'a32117123@gmail.com' };
const ADMIN_NOTIFICATION_EMAIL = 'a32117123@gmail.com';

if (process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim() && !process.env.BREVO_API_KEY.startsWith('your_')) {
  try {
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY.trim();
    brevoClient = new SibApiV3Sdk.TransactionalEmailsApi();
    console.log('[Brevo] ✅ Transactional email client initialized — sender:', BREVO_SENDER.email);
  } catch (initErr) {
    console.error('[Brevo] ❌ Failed to initialize email client:', initErr.message);
    brevoClient = null;
  }
} else {
  console.warn('[Brevo] ⚠️  BREVO_API_KEY is missing or placeholder — emails will be logged to console only (offline mode)');
}

const app = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────────────
// Single source of truth.
//
// DATABASE_URL is validated above, so this is always a real client. There is
// no JSON fallback mode any more, and no `if (prisma)` guards: the app either
// has a database or it refuses to start.
//
// data/admin_store.json used to be a SECOND source of truth written alongside
// Postgres. The two stores could not hold the same fields (the Booking table
// had no email column), so records silently lost email / leadSource /
// emailSent, status changes appeared to revert, and ids diverged between the
// stores. Worse, two processes writing that file whole-file lost 35% of
// concurrent writes. It is no longer a write target.
// ──────────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'stdout' },
    { level: 'error', emit: 'stdout' },
  ],
});

const DATA_DIR = path.join(__dirname, 'data');
const LEGACY_STORE_PATH = path.join(DATA_DIR, 'admin_store.json');

// Suppression list for records that still exist as live Calendly events.
// Replaces store.deletedCalendlyUris, which lived in the JSON file.
async function getDeletedRefs() {
  const rows = await prisma.deletedEvent.findMany({ select: { ref: true } });
  return new Set(rows.map(r => r.ref));
}

async function addDeletedRefs(refs) {
  const clean = Array.from(new Set((refs || []).filter(Boolean).map(String)));
  if (clean.length === 0) return 0;
  const result = await prisma.deletedEvent.createMany({
    data: clean.map(ref => ({ ref })),
    skipDuplicates: true,
  });
  return result.count;
}

// Read-only JSON export, generated from Postgres on demand. The file on disk
// is never written by the app; this is the replacement for anyone who was
// reading data/admin_store.json directly.
async function buildStoreExport() {
  const [bookings, leads, deleted] = await Promise.all([
    prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.lead.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.deletedEvent.findMany({ select: { ref: true } }),
  ]);
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'postgresql',
      note: 'Read-only export generated from the database. data/admin_store.json is no longer written.',
    },
    bookings,
    leads,
    deletedCalendlyUris: deleted.map(d => d.ref),
  };
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────────────────────
// Strip NUL bytes from incoming text.
//
// PostgreSQL cannot store U+0000 in a text column — it rejects the whole
// statement with "22021 invalid byte sequence for encoding UTF8: 0x00". A NUL
// arriving in a name or note field therefore turned a routine form post into a
// 500. It has no legitimate use in any of these fields, so it is stripped
// rather than rejected: the rest of the submission is still good data.
// ──────────────────────────────────────────────────────
function stripNulls(value, depth = 0) {
  if (depth > 20) return value;
  if (typeof value === 'string') return value.replace(/\u0000/g, '');
  if (Array.isArray(value)) return value.map(v => stripNulls(v, depth + 1));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = stripNulls(value[key], depth + 1);
    }
  }
  return value;
}

app.use((req, res, next) => {
  if (req.body) req.body = stripNulls(req.body);
  next();
});

// Ensure all HTML, JS, CSS, and API requests bypass stale browser caches
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ──────────────────────────────────────────────────────
// Static file surface.
//
// This used to be express.static(__dirname), which served the ENTIRE repo
// root. GET /data/admin_store.json returned HTTP 200 with every lead's name,
// email and phone to anyone who asked — no credentials, no knowledge of the
// API required. /package.json and /prisma/schema.prisma were public too.
// (.env happened to be safe only because express.static ignores dotfiles.)
//
// Only the directories and files that are genuinely public are served now.
// ──────────────────────────────────────────────────────
const staticOptions = {
  etag: false,
  maxAge: 0,
  dotfiles: 'deny',
  index: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
};

app.use('/css', express.static(path.join(__dirname, 'css'), staticOptions));
app.use('/js', express.static(path.join(__dirname, 'js'), staticOptions));
app.use('/assets', express.static(path.join(__dirname, 'assets'), staticOptions));

// The three public HTML entry points, served explicitly.
const PUBLIC_PAGES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/admin.html': 'admin.html',
  '/audit.html': 'audit.html',
};

for (const [route, file] of Object.entries(PUBLIC_PAGES)) {
  app.get(route, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, file));
  });
}

// ──────────────────────────────────────────────────────
// Admin authentication.
//
// Every /api/admin/* route was completely unauthenticated: anyone could read
// the full lead database or delete bookings. This gate fails CLOSED — the
// startup check refuses to boot without ADMIN_API_KEY, so there is no
// configuration in which these routes are reachable without a secret.
//
// The secret may be presented three ways, all equivalent:
//   Authorization: Bearer <key>
//   X-Admin-Key: <key>
//   Cookie: amc_admin=<key>        (set by POST /api/admin/login)
// ──────────────────────────────────────────────────────
const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractAdminKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.headers['x-admin-key']) return String(req.headers['x-admin-key']).trim();

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'amc_admin') return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;

  // Defensive: startup already guarantees this, but never fail open.
  if (!expected || !expected.trim()) {
    console.error('[Admin Auth] ADMIN_API_KEY is not configured — denying access.');
    return res.status(503).json({ success: false, error: 'Admin API is not configured' });
  }

  const presented = extractAdminKey(req);
  if (!presented || !timingSafeEqual(presented, expected)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

// Exchange the shared secret for a session cookie so admin.html can call the
// API normally. The cookie holds the same secret; it is HttpOnly so page
// scripts cannot read it, and SameSite=Strict so other sites cannot use it.
app.post('/api/admin/login', (req, res) => {
  const expected = process.env.ADMIN_API_KEY;
  const presented = (req.body && req.body.key) ? String(req.body.key) : extractAdminKey(req);

  if (!presented || !timingSafeEqual(presented, expected)) {
    return res.status(401).json({ success: false, error: 'Invalid admin key' });
  }

  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', [
    `amc_admin=${encodeURIComponent(presented)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + (12 * 60 * 60), // 12 hours
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; '));

  return res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'amc_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  return res.json({ success: true });
});

// Lets admin.html discover whether the browser already holds a valid session.
app.get('/api/admin/session', (req, res) => {
  const expected = process.env.ADMIN_API_KEY;
  const presented = extractAdminKey(req);
  const authenticated = Boolean(presented && expected && timingSafeEqual(presented, expected));
  return res.json({ success: true, authenticated });
});

// Everything else under /api/admin/* requires the secret.
app.use('/api/admin', requireAdmin);

// Cache for event type URIs
const eventTypeCache = {
  counsellor1: { uri: null, duration: null, name: null, expiresAt: 0 },
  counsellor2: { uri: null, duration: null, name: null, expiresAt: 0 }
};
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours cache TTL

const counsellorProfileCache = {
  counsellor1: { name: null, email: null, expiresAt: 0 },
  counsellor2: { name: null, email: null, expiresAt: 0 }
};

// Cache for Month Availability to keep response instantaneous.
// Keyed by timezone + counsellor scope, because the computed dates depend on
// both. Previously this object was assigned but NEVER READ, so every single
// request rebuilt it from scratch — see MONTH_CACHE_TTL below.
let monthAvailCache = new Map();

function monthCacheKey(tzName, scope) {
  return `${tzName}|${scope}`;
}
const MONTH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache TTL

// Cache for live scheduled events from Calendly
let scheduledEventsCache = {
  events: [],
  expiresAt: 0
};
const SCHEDULED_EVENTS_CACHE_TTL = 60 * 1000; // 1 minute cache TTL

function reloadCalendlyEnv() {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
}

function resetCalendlyCaches() {
  eventTypeCache.counsellor1 = { uri: null, duration: null, name: null, expiresAt: 0 };
  eventTypeCache.counsellor2 = { uri: null, duration: null, name: null, expiresAt: 0 };
  counsellorProfileCache.counsellor1 = { name: null, email: null, expiresAt: 0 };
  counsellorProfileCache.counsellor2 = { name: null, email: null, expiresAt: 0 };
  monthAvailCache = {
    availableDates: [],
    c1Map: {},
    c2Map: {},
    expiresAt: 0
  };
  scheduledEventsCache = {
    events: [],
    expiresAt: 0
  };
}

function toIsoStringOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function toDisplayDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// Must stay in lockstep with the BookingStatus enum in prisma/schema.prisma.
// Previously normalizeBookingStatus could return COMPLETED, which the enum did
// not contain: Prisma threw, a "non-fatal" catch swallowed it, the API still
// reported success, and the panel showed the old value on the next refresh.
const SUPPORTED_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

function normalizeBookingStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'CONFIRMED' || raw === 'ACTIVE') return 'CONFIRMED';
  if (raw === 'CANCELLED' || raw === 'CANCELED') return 'CANCELLED';
  if (raw === 'COMPLETED') return 'COMPLETED';
  return 'PENDING';
}

function isSupportedBookingStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  const aliases = { ACTIVE: 'CONFIRMED', CANCELED: 'CANCELLED' };
  return SUPPORTED_BOOKING_STATUSES.includes(aliases[raw] || raw);
}

async function getLastAssignedCounsellor() {
  try {
    // Most recent booking that names a counsellor, resolved by the database
    // rather than by scanning a whole JSON array in memory.
    const lastBooking = await prisma.booking.findFirst({
      where: {
        OR: [
          { selectedCounsellorId: { not: null } },
          { selectedCounsellor: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { selectedCounsellorId: true, selectedCounsellor: true },
    });

    if (lastBooking) {
      const counsellorStr = String(lastBooking.selectedCounsellorId || lastBooking.selectedCounsellor || '').toLowerCase();
      if (counsellorStr.includes('counsellor2') || counsellorStr.includes('aryan') || counsellorStr.includes('manasvi')) {
        return 'counsellor2';
      }
      if (counsellorStr.includes('counsellor1') || counsellorStr.includes('samir')) {
        return 'counsellor1';
      }
    }
  } catch (err) {
    console.error('[getLastAssignedCounsellor Error]', err && err.stack ? err.stack : err);
  }
  return null;
}

async function getCounsellorName(counsellorId) {
  const cached = counsellorProfileCache[counsellorId];
  if (cached.name && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  const token = counsellorId === 'counsellor1' ? process.env.CALENDLY_API_TOKEN_1 : process.env.CALENDLY_API_TOKEN_2;
  if (!token || token.startsWith('your_')) {
    return counsellorId === 'counsellor1' ? 'Counsellor 1' : 'Counsellor 2';
  }

  const userUuid = getUserUuidFromToken(token);
  if (!userUuid) {
    return counsellorId === 'counsellor1' ? 'Counsellor 1' : 'Counsellor 2';
  }

  const userUri = `https://api.calendly.com/users/${userUuid}`;

  try {
    // 1. Try users profile endpoint (might fail due to scope)
    const response = await fetch(userUri, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const apiName = (data && data.resource && data.resource.name) ? String(data.resource.name).trim() : '';
      const apiEmail = (data && data.resource && data.resource.email) ? String(data.resource.email).trim() : '';
      if (apiName) {
        counsellorProfileCache[counsellorId] = { name: apiName, email: apiEmail, expiresAt: Date.now() + CACHE_TTL };
        return apiName;
      }
    }
  } catch (err) {
    console.warn(`[getCounsellorName users/me warning for ${counsellorId}]`, err);
  }

  try {
    // 2. Fallback to event_types endpoint (requires event_types:read which is present)
    const url = `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const collection = data.collection || [];
      if (collection.length > 0) {
        const profileName = collection[0].profile ? collection[0].profile.name : '';
        if (profileName) {
          const resolvedName = String(profileName).trim();
          counsellorProfileCache[counsellorId] = { name: resolvedName, email: '', expiresAt: Date.now() + CACHE_TTL };
          return resolvedName;
        }
      }
    }
  } catch (err) {
    console.warn(`[getCounsellorName event_types warning for ${counsellorId}]`, err);
  }

  // 3. Final fallback to parse from URL if possible
  const configUrl = counsellorId === 'counsellor1' ? process.env.CALENDLY_URL_1 : process.env.CALENDLY_URL_2;
  if (configUrl) {
    try {
      const parsed = new URL(configUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const resolvedName = parts[0];
        counsellorProfileCache[counsellorId] = { name: resolvedName, email: '', expiresAt: Date.now() + CACHE_TTL };
        return resolvedName;
      }
    } catch (e) { }
  }

  return counsellorId === 'counsellor1' ? 'Counsellor 1' : 'Counsellor 2';
}

// Helper to decode user_uuid from Calendly Personal Access Token (JWT)
function getUserUuidFromToken(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.user_uuid;
  } catch (err) {
    console.error('[Calendly Token Decode Error]', err);
    return null;
  }
}

// Helper to get and cache event type URI for a counsellor
async function getEventTypeUri(counsellorId) {
  const cache = eventTypeCache[counsellorId];
  if (cache.uri && cache.expiresAt > Date.now()) {
    return cache.uri;
  }

  const token = counsellorId === 'counsellor1' ? process.env.CALENDLY_API_TOKEN_1 : process.env.CALENDLY_API_TOKEN_2;
  const configUrl = counsellorId === 'counsellor1' ? process.env.CALENDLY_URL_1 : process.env.CALENDLY_URL_2;

  if (!token || token.startsWith('your_') || !configUrl || configUrl.startsWith('your_')) {
    throw new Error(`Configuration missing or placeholder for ${counsellorId}`);
  }

  const userUuid = getUserUuidFromToken(token);
  if (!userUuid) {
    throw new Error(`Could not extract user UUID from token for ${counsellorId}`);
  }

  const userUri = `https://api.calendly.com/users/${userUuid}`;
  const response = await fetch(`https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list event types: Status ${response.status} - ${text}`);
  }

  const data = await response.json();
  const cleanConfigUrl = configUrl.trim().replace(/\/$/, '').toLowerCase();

  const matched = (data.collection || []).find(et => {
    if (!et.scheduling_url) return false;
    return et.scheduling_url.trim().replace(/\/$/, '').toLowerCase() === cleanConfigUrl;
  });

  if (!matched) {
    throw new Error(`Could not find event type matching URL ${configUrl} for ${counsellorId}`);
  }

  cache.uri = matched.uri;
  cache.duration = matched.duration;
  cache.name = matched.name;
  cache.expiresAt = Date.now() + CACHE_TTL;
  return matched.uri;
}

// Isolated Helper: Extract Google Meet / Conference details defensively from Calendly payload
function extractCalendlyMeetingDetails(eventResource, inviteeResource = null) {
  if (!eventResource) {
    return { googleMeetUrl: null, locationType: 'pending', status: null, isPending: true, rawLocation: null };
  }

  const loc = eventResource.location || {};
  const rawType = loc.type || (loc.data && loc.data.type) || null;
  const status = loc.status || (loc.data && loc.data.status) || null;

  const candidates = [
    loc.join_url,
    loc.location,
    loc.data && loc.data.join_url,
    loc.data && loc.data.location,
    loc.data && loc.data.url,
    inviteeResource && inviteeResource.meeting_url,
    inviteeResource && inviteeResource.location
  ];

  let resolvedUrl = null;
  for (const c of candidates) {
    if (typeof c === 'string' && (c.startsWith('http://') || c.startsWith('https://'))) {
      resolvedUrl = c.trim();
      break;
    }
  }

  let resolvedType = rawType || 'custom';
  if (resolvedUrl && (resolvedUrl.includes('google_meet') || resolvedUrl.includes('meet.google.com') || resolvedType === 'google_conference' || resolvedType === 'google_meet')) {
    resolvedType = 'google_conference';
  }

  const isConference = (resolvedType === 'google_conference' || resolvedType === 'google_meet' || rawType === 'google_conference');
  const isPending = (isConference && !resolvedUrl && status !== 'failed') || (!resolvedUrl && (status === 'initiated' || status === 'pending'));

  return {
    googleMeetUrl: resolvedUrl,
    locationType: isPending ? 'pending' : resolvedType,
    status: status,
    isPending: Boolean(isPending),
    rawLocation: loc
  };
}

// How long POST /api/calendly/confirm will wait for a Google Meet link before
// answering "pending" and leaving it to the frontend poller and the sweep.
const CONFIRM_RETRY_MS = 9000;
const CONFIRM_RETRY_INTERVAL_MS = 3000;

// Isolated Helper: Fetch Calendly scheduled event with retry loop for pending conference details
async function fetchCalendlyEventWithRetry(eventUri, token, maxWaitMs = 9000, intervalMs = 3000) {
  const uuid = eventUri.split('/').filter(Boolean).pop();
  const eventApiUrl = `https://api.calendly.com/scheduled_events/${uuid}`;
  const startTime = Date.now();
  let lastResource = null;
  let lastInvitee = null;
  let meetingDetails = { googleMeetUrl: null, locationType: 'pending', isPending: true };

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await fetch(eventApiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (resp.ok) {
        const json = await resp.json();
        lastResource = json.resource;

        try {
          const invResp = await fetch(`${eventApiUrl}/invitees`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          if (invResp.ok) {
            const invJson = await invResp.json();
            lastInvitee = (invJson.collection && invJson.collection[0]) || null;
          }
        } catch (invErr) {
          console.warn('[Calendly Invitee Fetch Warning]', invErr.message);
        }

        meetingDetails = extractCalendlyMeetingDetails(lastResource, lastInvitee);

        if (meetingDetails.googleMeetUrl || !meetingDetails.isPending) {
          return {
            success: true,
            resource: lastResource,
            invitee: lastInvitee,
            ...meetingDetails
          };
        }
      }
    } catch (err) {
      console.warn('[Calendly Fetch Retry Error]', err.message);
    }

    if (Date.now() - startTime + intervalMs >= maxWaitMs) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return {
    success: Boolean(lastResource),
    resource: lastResource,
    invitee: lastInvitee,
    googleMeetUrl: meetingDetails.googleMeetUrl || null,
    locationType: 'pending',
    isPending: true
  };
}

// ──────────────────────────────────────────────────────
// Booking Confirmation Email via Brevo (Sendinblue)
// Sends meeting details + Google Meet link to student
// ──────────────────────────────────────────────────────
async function sendBookingConfirmationEmail(booking) {
  const recipientEmail = booking.email;
  const recipientName = booking.name || 'Student';
  const googleMeetUrl = booking.googleMeetUrl;
  const startTime = booking.scheduledStartTime;
  const counsellorName = booking.selectedCounsellor || 'Your AMC Counsellor';
  const eventName = booking.calendlyEventName || 'AMC Counselling Session';
  const bookingId = booking.id || 'N/A';

  console.log('[Brevo Email] ──── SEND ATTEMPT ────');
  console.log('[Brevo Email]   Booking ID:', bookingId);
  console.log('[Brevo Email]   Recipient:', recipientEmail || 'NONE');
  console.log('[Brevo Email]   Meet URL:', googleMeetUrl || 'NONE');

  if (!recipientEmail) {
    console.warn('[Brevo Email]   ⚠️ SKIPPED — no recipient email for booking', bookingId);
    return { sent: false, reason: 'no_recipient_email' };
  }

  if (!googleMeetUrl) {
    console.warn('[Brevo Email]   ⚠️ SKIPPED — no Google Meet URL yet for booking', bookingId, '(will send when resolved)');
    return { sent: false, reason: 'no_meet_url_yet' };
  }

  // Format date/time for email display
  let formattedDate = 'your scheduled date';
  let formattedTime = '';
  let timezoneLabel = '';
  if (startTime) {
    try {
      const d = new Date(startTime);
      const tz = booking.timezone || process.env.CALENDLY_TIMEZONE || 'UTC';
      formattedDate = d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
      formattedTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz });
      timezoneLabel = tz.replace(/_/g, ' ');
    } catch (e) {
      formattedDate = String(startTime);
    }
  }

  const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width:560px; margin:32px auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg, #059669 0%, #10b981 100%); padding:36px 28px; text-align:center;">
      <div style="width:48px; height:48px; border-radius:50%; background:rgba(255,255,255,0.2); margin:0 auto 14px; line-height:48px; font-size:24px; color:#fff;">&#10003;</div>
      <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:800; letter-spacing:-0.02em;">Session Confirmed</h1>
      <p style="margin:8px 0 0 0; color:rgba(255,255,255,0.88); font-size:14px;">Your counselling appointment is booked</p>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 20px 0; font-size:15px; color:#1e293b; line-height:1.5;">Hi <strong>${recipientName}</strong>,</p>
      <p style="margin:0 0 24px 0; font-size:14px; color:#475569; line-height:1.6;">Your session with <strong>AMC by DRG</strong> has been confirmed. Here are your booking details:</p>
      <div style="background:#f8fafc; border-radius:12px; padding:20px; margin-bottom:20px; border:1px solid #e2e8f0;">
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="padding:10px 0; font-size:13px; color:#64748b; font-weight:600; width:35%;">Session</td><td style="padding:10px 0; font-size:14px; color:#1e293b; font-weight:700;">${eventName}</td></tr>
          <tr><td style="padding:10px 0; font-size:13px; color:#64748b; font-weight:600; border-top:1px solid #e2e8f0;">Date</td><td style="padding:10px 0; font-size:14px; color:#1e293b; font-weight:700; border-top:1px solid #e2e8f0;">${formattedDate}</td></tr>
          ${formattedTime ? '<tr><td style="padding:10px 0; font-size:13px; color:#64748b; font-weight:600; border-top:1px solid #e2e8f0;">Time</td><td style="padding:10px 0; font-size:14px; color:#1e293b; font-weight:700; border-top:1px solid #e2e8f0;">' + formattedTime + (timezoneLabel ? ' (' + timezoneLabel + ')' : '') + '</td></tr>' : ''}
          <tr><td style="padding:10px 0; font-size:13px; color:#64748b; font-weight:600; border-top:1px solid #e2e8f0;">Counsellor</td><td style="padding:10px 0; font-size:14px; color:#1e293b; font-weight:700; border-top:1px solid #e2e8f0;">${counsellorName}</td></tr>
        </table>
      </div>
      <div style="background:#f0fdf4; border:2px solid #86efac; border-radius:12px; padding:24px; margin:20px 0; text-align:center;">
        <div style="margin-bottom:12px;"><span style="font-size:14px; font-weight:700; color:#166534;">Join via Google Meet</span></div>
        <a href="${googleMeetUrl}" target="_blank" style="display:inline-block; background:#059669; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:8px; font-weight:700; font-size:15px;">Join Meeting &rarr;</a>
        <p style="margin:14px 0 0 0; font-size:12px; color:#6b7280; word-break:break-all; line-height:1.4;">${googleMeetUrl}</p>
      </div>
      <p style="margin:24px 0 0 0; font-size:13px; color:#64748b; line-height:1.6;">Need to reschedule or cancel? Use the links in your Calendly confirmation email.<br>We look forward to meeting you!</p>
    </div>
    <div style="background:#f1f5f9; padding:16px 28px; text-align:center; border-top:1px solid #e2e8f0;">
      <p style="margin:0; font-size:11px; color:#94a3b8;">&copy; ${new Date().getFullYear()} AMC by DRG</p>
    </div>
  </div>
</body>
</html>`;

  const subject = `Your ${eventName} is Confirmed — ${formattedDate}${formattedTime ? ' at ' + formattedTime : ''}`;

  // Build recipient list: student + admin BCC
  const toList = [{ email: recipientEmail, name: recipientName }];
  const bccList = [];
  if (ADMIN_NOTIFICATION_EMAIL && ADMIN_NOTIFICATION_EMAIL.toLowerCase() !== recipientEmail.toLowerCase()) {
    bccList.push({ email: ADMIN_NOTIFICATION_EMAIL, name: 'AMC Admin' });
  }

  // OFFLINE MODE — Brevo key is missing, just log
  if (!brevoClient) {
    console.log('[Brevo Email]   📧 OFFLINE MODE — would have sent:');
    console.log('[Brevo Email]     Subject:', subject);
    console.log('[Brevo Email]     From:', BREVO_SENDER.name, '<' + BREVO_SENDER.email + '>');
    console.log('[Brevo Email]     To:', JSON.stringify(toList));
    console.log('[Brevo Email]     BCC:', JSON.stringify(bccList));
    return { sent: false, reason: 'brevo_client_not_initialized' };
  }

  // LIVE MODE — send via Brevo Transactional API
  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = BREVO_SENDER;
    sendSmtpEmail.to = toList;
    if (bccList.length > 0) sendSmtpEmail.bcc = bccList;
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;

    console.log('[Brevo Email]   📤 Calling Brevo sendTransacEmail API...');
    console.log('[Brevo Email]     Sender:', BREVO_SENDER.name, '<' + BREVO_SENDER.email + '>');
    console.log('[Brevo Email]     To:', recipientEmail, '(' + recipientName + ')');
    if (bccList.length > 0) console.log('[Brevo Email]     BCC:', bccList.map(function (b) { return b.email; }).join(', '));
    console.log('[Brevo Email]     Subject:', subject);

    const result = await brevoClient.sendTransacEmail(sendSmtpEmail);

    console.log('[Brevo Email]   ✅ SUCCESS — Email sent!');
    console.log('[Brevo Email]     Brevo messageId:', result.messageId || JSON.stringify(result));
    console.log('[Brevo Email]     Full Brevo Response:', JSON.stringify(result));
    return { sent: true, messageId: result.messageId, response: result };

  } catch (brevoErr) {
    console.error('[Brevo Email]   ❌ FAILED — Brevo API returned an error');
    console.error('[Brevo Email]     Recipient:', recipientEmail);
    console.error('[Brevo Email]     Subject:', subject);
    if (brevoErr.response) {
      console.error('[Brevo Email]     HTTP Status:', brevoErr.response.status || brevoErr.status || 'unknown');
      console.error('[Brevo Email]     Error Body:', JSON.stringify(brevoErr.response.body || brevoErr.response.text || brevoErr.response.data || 'no body'));
    } else {
      console.error('[Brevo Email]     Error:', brevoErr.message || JSON.stringify(brevoErr));
      console.error('[Brevo Email]     Stack:', brevoErr.stack || 'no stack');
    }
    return { sent: false, reason: 'brevo_api_error', error: brevoErr.message || String(brevoErr) };
  }
}

// Fetch availability slots for a counsellor with retry for future start_time requirements
async function fetchAvailability(counsellorId, eventTypeUri, startTimeIso, endTimeIso) {
  const token = counsellorId === 'counsellor1' ? process.env.CALENDLY_API_TOKEN_1 : process.env.CALENDLY_API_TOKEN_2;
  if (!token || token.startsWith('your_')) {
    throw new Error(`API token unconfigured or placeholder for ${counsellorId}`);
  }

  const callApi = async (sTime) => {
    const url = new URL('https://api.calendly.com/event_type_available_times');
    url.searchParams.set('event_type', eventTypeUri);
    url.searchParams.set('start_time', sTime);
    url.searchParams.set('end_time', endTimeIso);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Calendly status ${response.status} - ${text}`);
      }

      const data = await response.json();
      return data.collection || [];
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  try {
    return await callApi(startTimeIso);
  } catch (err) {
    if (err.message.includes('start_time must be in the future') || err.message.includes('400')) {
      const retryStartTime = new Date(Date.now() + 180000).toISOString();
      return await callApi(retryStartTime);
    }
    throw err;
  }
}

// Helper to determine local hour in specific timezone
function getLocalHour(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timeZone
    });
    return parseInt(formatter.format(date), 10);
  } catch (err) {
    return date.getUTCHours();
  }
}

function getLocalMinute(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      minute: '2-digit',
      timeZone: timeZone
    });
    return parseInt(formatter.format(date), 10);
  } catch (err) {
    return date.getUTCMinutes();
  }
}

function formatLocalTime(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timeZone
    });
    return formatter.format(date);
  } catch (err) {
    return date.toTimeString().slice(0, 5);
  }
}

function getLocalDateStr(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(d);
  } catch (e) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

function normalizeDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  dateStr = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const parts = dateStr.split(/[-/]/);
  if (parts.length === 3) {
    // Every component must be numeric. Without this check "not-a-date" split to
    // ['not','a','date'], parseInt gave NaN, and the function returned the
    // string "date-NaN-NaN" — which is truthy, so validation passed and the
    // request 500'd later when the range was built.
    const nums = parts.map(p => parseInt(p, 10));
    const allNumeric = parts.every(p => /^\d+$/.test(p.trim())) && nums.every(n => Number.isInteger(n));

    if (allNumeric) {
      if (parts[0].length === 4) {
        const y = nums[0], m = nums[1], d = nums[2];
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          return `${parts[0]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        return null;
      }
      if (parts[2].length === 4) {
        const p1 = nums[0];
        const p2 = nums[1];
        let day, month;
        if (p1 > 12) {
          day = p1; month = p2;
        } else if (p2 > 12) {
          month = p1; day = p2;
        } else {
          day = p1; month = p2;
        }
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        return `${parts[2]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

function getUtcRangeForLocalDate(dateStr, tzOffset) {
  const start = new Date(`${dateStr}T00:00:00.000${tzOffset}`);
  const end = new Date(`${dateStr}T23:59:59.999${tzOffset}`);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid local date or timezone offset for range build: ${dateStr}, ${tzOffset}`);
  }

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function resolveTimeZone(requestedTz, fallbackTz) {
  const tz = (requestedTz || fallbackTz || 'UTC').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch (_err) {
    return fallbackTz || 'UTC';
  }
}

function resolveTzOffset(requestedOffset, fallbackOffset) {
  const offset = (requestedOffset || fallbackOffset || '+00:00').trim();
  return /^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(offset) ? offset : (fallbackOffset || '+00:00');
}

function resolveCounsellorScope(raw) {
  const scope = String(raw || '').trim().toLowerCase();
  if (scope === 'counsellor1' || scope === 'counsellor2') return scope;
  return 'both';
}

// ──────────────────────────────────────────────────────
// Per-counsellor failure isolation.
//
// getAllActiveEventUris throws when Calendly rejects a token or times out.
// Under Promise.all a single rejection took down availability for BOTH
// counsellors, so one stale token produced a total outage that looked
// intermittent — it healed the moment the transient passed. These helpers let
// each counsellor fail on its own while the other still serves real slots.
// ──────────────────────────────────────────────────────
function settle(promise) {
  return Promise.resolve(promise).then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error })
  );
}

function unwrapUris(result) {
  if (Array.isArray(result)) return result;          // scope-skipped counsellor
  if (result && result.ok) return result.value || [];
  return [];
}

function collectCounsellorErrors(...results) {
  const errors = [];
  results.forEach((result, index) => {
    if (!Array.isArray(result) && result && result.ok === false) {
      errors.push({
        counsellor: `counsellor${index + 1}`,
        error: (result.error && result.error.message) ? result.error.message : String(result.error),
      });
    }
  });
  return errors;
}

// Helper to resolve the configured event type URI for a counsellor.
// This intentionally uses the .env scheduling URL so data is fetched for the intended meeting type only.
async function getAllActiveEventUris(counsellorId) {
  const configuredUri = await getEventTypeUri(counsellorId);
  return [configuredUri];
}

async function buildLiveAvailabilitySnapshot(tzName) {
  const [c1Name, c2Name] = await Promise.all([
    getCounsellorName('counsellor1'),
    getCounsellorName('counsellor2')
  ]);

  // Isolated per counsellor: an unreachable Calendly account for one must not
  // blank the admin dashboard's availability panel for the other.
  const [uriRes1, uriRes2] = await Promise.all([
    settle(getAllActiveEventUris('counsellor1')),
    settle(getAllActiveEventUris('counsellor2')),
  ]);
  const uris1 = unwrapUris(uriRes1);
  const uris2 = unwrapUris(uriRes2);
  const counsellorErrors = collectCounsellorErrors(uriRes1, uriRes2);
  if (counsellorErrors.length > 0) {
    console.warn('[Availability Snapshot] degraded:',
      counsellorErrors.map(e => `${e.counsellor}: ${e.error}`).join(' | '));
  }

  const now = Date.now();
  const chunks = [
    [new Date(now + 120000).toISOString(), new Date(now + 30 * 86400000).toISOString()],
    [new Date(now + 30 * 86400000 + 1000).toISOString(), new Date(now + 60 * 86400000).toISOString()],
    [new Date(now + 60 * 86400000 + 1000).toISOString(), new Date(now + 90 * 86400000).toISOString()],
    [new Date(now + 90 * 86400000 + 1000).toISOString(), new Date(now + 120 * 86400000).toISOString()]
  ];

  const promises1 = [];
  const promises2 = [];

  chunks.forEach(([sIso, eIso]) => {
    uris1.forEach(uri => promises1.push(fetchAvailability('counsellor1', uri, sIso, eIso)));
    uris2.forEach(uri => promises2.push(fetchAvailability('counsellor2', uri, sIso, eIso)));
  });

  const [res1, res2] = await Promise.all([
    Promise.allSettled(promises1),
    Promise.allSettled(promises2)
  ]);

  const slots1 = res1.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(s => s.status === 'available');
  const slots2 = res2.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(s => s.status === 'available');

  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit' });
  const c1Map = {};
  const c2Map = {};

  for (const s of slots1) {
    if (!s.start_time) continue;
    const dKey = formatter.format(new Date(s.start_time));
    c1Map[dKey] = (c1Map[dKey] || 0) + 1;
  }

  for (const s of slots2) {
    if (!s.start_time) continue;
    const dKey = formatter.format(new Date(s.start_time));
    c2Map[dKey] = (c2Map[dKey] || 0) + 1;
  }

  const failedFor = new Set(counsellorErrors.map(e => e.counsellor));

  return {
    success: true,
    degraded: counsellorErrors.length > 0,
    counsellorErrors,
    counsellor1: {
      id: 'counsellor1',
      name: c1Name,
      url: process.env.CALENDLY_URL_1,
      totalSlots: slots1.length,
      // Distinguishes "genuinely no slots" from "we could not ask".
      reachable: !failedFor.has('counsellor1'),
      availableDates: c1Map
    },
    counsellor2: {
      id: 'counsellor2',
      name: c2Name,
      url: process.env.CALENDLY_URL_2,
      totalSlots: slots2.length,
      reachable: !failedFor.has('counsellor2'),
      availableDates: c2Map
    }
  };
}

let recentScheduledThrottleCache = { time: 0, events: [] };

// Live Scheduled Events from Calendly
async function fetchCalendlyScheduledEvents(forceRefresh = false, minCreatedAtIso = null) {
  if (!forceRefresh && !minCreatedAtIso && scheduledEventsCache.events.length > 0 && scheduledEventsCache.expiresAt > Date.now()) {
    return scheduledEventsCache.events;
  }
  if (minCreatedAtIso && (Date.now() - recentScheduledThrottleCache.time < 3000) && recentScheduledThrottleCache.events.length > 0) {
    return recentScheduledThrottleCache.events;
  }

  const counsellors = [
    { id: 'counsellor1', token: process.env.CALENDLY_API_TOKEN_1, url: process.env.CALENDLY_URL_1 },
    { id: 'counsellor2', token: process.env.CALENDLY_API_TOKEN_2, url: process.env.CALENDLY_URL_2 }
  ];

  const allEvents = [];

  for (const c of counsellors) {
    if (!c.token || c.token.startsWith('your_')) continue;
    const userUuid = getUserUuidFromToken(c.token);
    if (!userUuid) continue;

    const counsellorName = await getCounsellorName(c.id);

    try {
      const userUri = `https://api.calendly.com/users/${userUuid}`;
      const url = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&count=50`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${c.token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!resp.ok) {
        console.warn(`[Calendly Events Warning] ${c.id} returned status ${resp.status}`);
        continue;
      }

      const json = await resp.json();
      const events = json.collection || [];

      // Fetch invitees for each event (filtering by creation time if requested)
      const filteredEvents = events.filter(event => {
        if (!minCreatedAtIso) return true;
        try {
          const eventCreated = new Date(event.created_at || 0).getTime();
          const minCreated = new Date(minCreatedAtIso).getTime();
          return eventCreated >= minCreated;
        } catch (e) {
          return true;
        }
      });

      const inviteePromises = filteredEvents.map(async (event) => {
        try {
          const invResp = await fetch(`${event.uri}/invitees`, {
            headers: {
              'Authorization': `Bearer ${c.token}`,
              'Content-Type': 'application/json'
            }
          });
          const invJson = invResp.ok ? await invResp.json() : { collection: [] };
          const invitee = (invJson.collection && invJson.collection[0]) || {};
          const meetingDetails = extractCalendlyMeetingDetails(event, invitee);

          return {
            id: event.uri,
            calendlyEventUri: event.uri,
            name: invitee.name || event.name || 'Student',
            email: invitee.email || null,
            phone: invitee.text_reminder_number || null,
            countryCode: null,
            preferredDate: toDisplayDateTime(event.start_time),
            selectedSlot: toDisplayDateTime(event.start_time),
            selectedCounsellor: counsellorName,
            selectedCounsellorId: c.id,
            selectedCounsellorUrl: c.url,
            scheduledStartTime: event.start_time,
            scheduledEndTime: event.end_time,
            googleMeetUrl: meetingDetails.googleMeetUrl,
            locationType: meetingDetails.locationType,
            calendlyEventName: event.name || 'AMC Counselling Session',
            status: event.status === 'active' ? 'CONFIRMED' : (event.status === 'canceled' ? 'CANCELLED' : 'PENDING'),
            source: 'Calendly Live',
            inviteeStatus: invitee.status || event.status,
            rescheduleUrl: invitee.reschedule_url || null,
            cancelUrl: invitee.cancel_url || null,
            timezone: invitee.timezone || process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata',
            questionsAndAnswers: invitee.questions_and_answers || [],
            notes: invitee.rescheduled ? 'Rescheduled session' : '',
            createdAt: event.created_at || new Date().toISOString(),
            updatedAt: event.updated_at || new Date().toISOString()
          };
        } catch (invErr) {
          const meetingDetails = extractCalendlyMeetingDetails(event, null);
          return {
            id: event.uri,
            calendlyEventUri: event.uri,
            name: event.name || 'Student',
            email: null,
            phone: null,
            selectedCounsellor: counsellorName,
            selectedCounsellorId: c.id,
            selectedCounsellorUrl: c.url,
            scheduledStartTime: event.start_time,
            scheduledEndTime: event.end_time,
            googleMeetUrl: meetingDetails.googleMeetUrl,
            locationType: meetingDetails.locationType,
            calendlyEventName: event.name || 'AMC Counselling Session',
            status: event.status === 'active' ? 'CONFIRMED' : 'CANCELLED',
            source: 'Calendly Live',
            createdAt: event.created_at,
            updatedAt: event.updated_at
          };
        }
      });

      const processed = await Promise.all(inviteePromises);
      allEvents.push(...processed);
    } catch (cErr) {
      console.error(`[Calendly Events Fetch Error] ${c.id}:`, cErr);
    }
  }

  recentScheduledThrottleCache = {
    events: allEvents,
    time: Date.now()
  };

  if (!minCreatedAtIso) {
    scheduledEventsCache = {
      events: allEvents,
      expiresAt: Date.now() + (2 * 60 * 1000)
    };
  }

  return allEvents;
}

// Get unified bookings: stored bookings (Postgres) merged with live Calendly events.
async function getUnifiedBookings(forceRefresh = false) {
  // Postgres is simply the store now. There is no second array to fall back to
  // and no wholesale `localBookings = dbBookings` replacement that used to drop
  // every field the Booking table could not hold.
  const [localBookings, deletedUris, leads] = await Promise.all([
    prisma.booking.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    getDeletedRefs(),
    getUnifiedLeads(),
  ]);

  // Create lookup maps by phone (last 10 digits) and by name
  const leadPhoneMap = new Map();
  const leadNameMap = new Map();
  for (const l of leads) {
    if (l.phone) {
      const cleanPhone = String(l.phone).replace(/\D/g, '').slice(-10);
      if (cleanPhone) leadPhoneMap.set(cleanPhone, l);
    }
    if (l.name) {
      leadNameMap.set(l.name.trim().toLowerCase(), l);
    }
  }

  const calendlyEvents = await fetchCalendlyScheduledEvents(forceRefresh);

  // Map to prevent duplicates
  const eventMap = new Map();

  // First add live Calendly events
  for (const ev of calendlyEvents) {
    if (deletedUris.has(ev.calendlyEventUri) || deletedUris.has(ev.id) || deletedUris.has(ev.uri)) {
      continue;
    }
    let matchedLead = null;
    if (ev.name && leadNameMap.has(ev.name.trim().toLowerCase())) {
      matchedLead = leadNameMap.get(ev.name.trim().toLowerCase());
    }
    if (matchedLead) {
      eventMap.set(ev.calendlyEventUri, {
        ...ev,
        phone: matchedLead.phone || ev.phone,
        leadSource: matchedLead.source || ev.leadSource || 'Website Lead',
        sourceOther: matchedLead.sourceOther || ev.sourceOther,
        countryCode: matchedLead.countryCode || ev.countryCode
      });
    } else {
      eventMap.set(ev.calendlyEventUri, {
        ...ev,
        leadSource: ev.leadSource || 'Calendly'
      });
    }
  }

  // Next merge local/db booking entries
  for (const lb of localBookings) {
    if (deletedUris.has(lb.id) || deletedUris.has(lb.calendlyEventUri)) {
      continue;
    }
    let matchedLead = null;
    if (lb.phone) {
      const cleanPhone = String(lb.phone).replace(/\D/g, '').slice(-10);
      if (cleanPhone && leadPhoneMap.has(cleanPhone)) matchedLead = leadPhoneMap.get(cleanPhone);
    }
    if (!matchedLead && lb.name && leadNameMap.has(lb.name.trim().toLowerCase())) {
      matchedLead = leadNameMap.get(lb.name.trim().toLowerCase());
    }

    let leadPlatform = null;
    if (matchedLead && matchedLead.source && matchedLead.source !== 'Website Form' && matchedLead.source !== 'Website Lead Modal') {
      leadPlatform = matchedLead.source;
    } else if (lb.leadSource && lb.leadSource !== 'Website Form' && lb.leadSource !== 'Website Lead Modal' && lb.leadSource !== 'Website Booking Intent') {
      leadPlatform = lb.leadSource;
    } else if (matchedLead && matchedLead.source) {
      leadPlatform = matchedLead.source;
    } else {
      leadPlatform = lb.leadSource || lb.source || 'Website Form';
    }

    const sourceOther = (matchedLead ? matchedLead.sourceOther : null) || lb.sourceOther || null;

    let matchedEventKey = null;
    if (lb.calendlyEventUri && eventMap.has(lb.calendlyEventUri)) {
      matchedEventKey = lb.calendlyEventUri;
    } else {
      // Find matching live event by contact (phone, email, or name)
      for (const [key, ev] of eventMap.entries()) {
        let contactMatches = false;

        if (lb.phone && ev.phone) {
          const cleanLbPhone = String(lb.phone).replace(/\D/g, '').slice(-10);
          const cleanEvPhone = String(ev.phone).replace(/\D/g, '').slice(-10);
          if (cleanLbPhone && cleanEvPhone && cleanLbPhone === cleanEvPhone) {
            contactMatches = true;
          }
        }

        if (!contactMatches && lb.email && ev.email) {
          if (lb.email.trim().toLowerCase() === ev.email.trim().toLowerCase()) {
            contactMatches = true;
          }
        }

        if (!contactMatches && lb.name && ev.name) {
          if (lb.name.trim().toLowerCase() === ev.name.trim().toLowerCase()) {
            contactMatches = true;
          }
        }

        if (contactMatches) {
          matchedEventKey = key;
          break;
        }
      }
    }

    if (matchedEventKey) {
      const existing = eventMap.get(matchedEventKey);
      let resolvedStatus = existing.status || 'CONFIRMED';
      if (lb.status === 'COMPLETED' || lb.status === 'CANCELLED') {
        resolvedStatus = lb.status;
      } else if (existing.status === 'CONFIRMED' || existing.status === 'active' || lb.status === 'CONFIRMED') {
        resolvedStatus = 'CONFIRMED';
      } else {
        resolvedStatus = lb.status || existing.status || 'PENDING';
      }

      eventMap.set(matchedEventKey, {
        ...existing,
        ...lb,
        id: existing.id || lb.id,
        calendlyEventUri: existing.calendlyEventUri || lb.calendlyEventUri,
        status: resolvedStatus,
        phone: lb.phone || existing.phone,
        email: existing.email || lb.email,
        name: lb.name || existing.name,
        googleMeetUrl: existing.googleMeetUrl || lb.googleMeetUrl || null,
        locationType: existing.locationType || lb.locationType || (existing.googleMeetUrl || lb.googleMeetUrl ? 'google_conference' : 'pending'),
        selectedSlot: existing.selectedSlot || lb.selectedSlot,
        preferredDate: existing.preferredDate || lb.preferredDate,
        selectedCounsellor: existing.selectedCounsellor || lb.selectedCounsellor,
        leadSource: leadPlatform,
        sourceOther: sourceOther,
        notes: lb.notes || existing.notes,
        createdAt: lb.createdAt || existing.createdAt || new Date().toISOString(),
        updatedAt: lb.updatedAt || existing.updatedAt || new Date().toISOString(),
        source: existing.source === 'Calendly Live' ? 'Calendly Live' : (lb.source || 'Calendly Confirmed + Web Intent')
      });
    } else {
      const key = lb.id || (lb.phone ? `${lb.phone}_${lb.preferredDate}` : `local_${Date.now()}_${Math.random()}`);
      eventMap.set(key, {
        ...lb,
        leadSource: leadPlatform,
        sourceOther: sourceOther,
        source: lb.source || 'Website Form'
      });
    }
  }

  const list = Array.from(eventMap.values());

  // Automatic Lead Enrichment for missing emails or lead sources
  for (const b of list) {
    const cleanPhone = b.phone ? String(b.phone).replace(/\D/g, '').slice(-10) : '';
    const cleanName = b.name ? String(b.name).trim().toLowerCase() : '';
    const matchedLead = (cleanPhone && leadPhoneMap.get(cleanPhone)) || (cleanName && leadNameMap.get(cleanName));

    if (matchedLead) {
      if (!b.email || b.email === 'null') b.email = matchedLead.email;
      const isPlaceholderSource = !b.leadSource || b.leadSource === 'Website Form' || b.leadSource === 'Website Lead Modal' || b.leadSource === 'Website Booking Intent' || b.leadSource === 'Calendly' || b.leadSource === 'Website Lead';
      if (isPlaceholderSource && matchedLead.source) {
        b.leadSource = matchedLead.source;
        b.sourceOther = matchedLead.sourceOther || b.sourceOther;
      }
      if (!b.countryCode) b.countryCode = matchedLead.countryCode;
    }
  }

  // Sort strictly by latest booking creation timestamp first (newest bookings at top)
  list.sort((a, b) => {
    const timeA = new Date(a.createdAt || a.updatedAt || a.scheduledStartTime || 0).getTime();
    const timeB = new Date(b.createdAt || b.updatedAt || b.scheduledStartTime || 0).getTime();
    return timeB - timeA;
  });

  return list;
}

// Get leads from the database.
async function getUnifiedLeads() {
  return prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 300 });
}

app.post('/api/admin/leads', async (req, res) => {
  try {
    const payload = req.body || {};
    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').trim();
    const phone = String(payload.phone || '').trim();
    const source = String(payload.source || '').trim();

    if (!name || !email || !phone || !source) {
      return res.status(400).json({ error: 'name, email, phone and source are required' });
    }

    // One write, one id. The lead's id is whatever Postgres assigned — there is
    // no second store handing out a different one.
    const created = await prisma.lead.create({
      data: {
        name,
        email,
        phone,
        source,
        sourceOther: payload.sourceOther ? String(payload.sourceOther).trim() : null,
        countryCode: payload.countryCode ? String(payload.countryCode).trim() : null,
      },
    });

    return res.json({ success: true, leadId: created.id });
  } catch (error) {
    // A failed write must never report success. This used to be a "non-fatal"
    // catch that logged a warning and returned {success:true} anyway.
    console.error('[Admin Lead Save Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to save lead' });
  }
});

app.post('/api/admin/bookings/intent', async (req, res) => {
  try {
    const payload = req.body || {};
    let email = payload.email ? String(payload.email).trim() : null;
    let leadSource = payload.source ? String(payload.source).trim() : null;
    const sourceOther = payload.sourceOther ? String(payload.sourceOther).trim() : null;

    // Automatic lookup from leads if email not directly supplied.
    if (!email && payload.phone) {
      const cleanPhone = String(payload.phone).replace(/\D/g, '').slice(-10);
      if (cleanPhone) {
        const matched = await prisma.lead.findFirst({
          where: { phone: { endsWith: cleanPhone } },
          orderBy: { createdAt: 'desc' },
        });
        if (matched) {
          email = matched.email;
          if (!leadSource) {
            leadSource = matched.sourceOther ? `${matched.source} (${matched.sourceOther})` : matched.source;
          }
        }
      }
    }

    const created = await prisma.booking.create({
      data: {
        name: payload.name ? String(payload.name).trim() : null,
        email: email,
        phone: payload.phone ? String(payload.phone).trim() : null,
        countryCode: payload.countryCode ? String(payload.countryCode).trim() : null,
        preferredDate: payload.preferredDate ? String(payload.preferredDate).trim() : null,
        selectedSlot: payload.selectedSlot ? String(payload.selectedSlot).trim() : null,
        selectedCounsellor: payload.selectedCounsellor ? String(payload.selectedCounsellor).trim() : null,
        selectedCounsellorUrl: payload.selectedCounsellorUrl ? String(payload.selectedCounsellorUrl).trim() : null,
        timezone: payload.timezone ? String(payload.timezone).trim() : null,
        leadSource: leadSource,
        sourceOther: sourceOther,
        notes: payload.notes ? String(payload.notes).trim() : null,
        status: 'PENDING',
        source: 'Website Booking Intent',
      },
    });

    return res.json({ success: true, bookingId: created.id });
  } catch (error) {
    console.error('[Admin Booking Intent Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to save booking intent' });
  }
});

app.post('/api/admin/bookings/confirm', async (req, res) => {
  try {
    const payload = req.body || {};
    const bookingId = payload.bookingId ? String(payload.bookingId).trim() : null;
    const eventUri = payload.calendlyEventUri ? String(payload.calendlyEventUri).trim() : null;
    const googleMeetUrl = payload.googleMeetUrl ? String(payload.googleMeetUrl).trim() : null;
    const locationType = payload.locationType ? String(payload.locationType).trim() : (googleMeetUrl ? 'google_conference' : null);

    if (!bookingId && !eventUri) {
      return res.status(400).json({ error: 'bookingId or calendlyEventUri is required' });
    }

    const data = {
      calendlyEventName: payload.calendlyEventName ? String(payload.calendlyEventName).trim() : undefined,
      scheduledStartTime: payload.scheduledStartTime ? new Date(payload.scheduledStartTime) : undefined,
      scheduledEndTime: payload.scheduledEndTime ? new Date(payload.scheduledEndTime) : undefined,
      googleMeetUrl: googleMeetUrl || undefined,
      locationType: locationType || undefined,
      status: normalizeBookingStatus(payload.status || 'CONFIRMED'),
      notes: payload.notes ? String(payload.notes).trim() : undefined,
    };

    let saved;

    if (bookingId) {
      // Scoped to the one record. If it does not exist, say so rather than
      // silently creating a duplicate under a different id.
      const existing = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Booking not found', bookingId });
      }
      saved = await prisma.booking.update({
        where: { id: bookingId },
        data: { ...data, calendlyEventUri: eventUri || undefined },
      });
    } else {
      // Atomic upsert on the unique calendlyEventUri. This is what makes a
      // double-clicked confirmation idempotent without any lock: two parallel
      // requests for the same event resolve to one row, decided by Postgres.
      saved = await prisma.booking.upsert({
        where: { calendlyEventUri: eventUri },
        update: data,
        create: {
          ...data,
          calendlyEventUri: eventUri,
          notes: payload.notes ? String(payload.notes).trim() : 'Inserted from confirmation callback',
        },
      });
    }

    // Force flush scheduled events cache to immediately reflect confirmation
    scheduledEventsCache.expiresAt = 0;

    return res.json({
      success: true,
      bookingId: saved.id,
      googleMeetUrl: saved.googleMeetUrl,
      locationType: saved.locationType,
    });
  } catch (error) {
    console.error('[Admin Booking Confirm Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to confirm booking' });
  }
});

// Update booking status or notes manually from admin
app.post('/api/admin/bookings/status', async (req, res) => {
  try {
    const { id, status, notes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    if (status && !isSupportedBookingStatus(status)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported status "${status}". Allowed: ${SUPPORTED_BOOKING_STATUSES.join(', ')}`,
      });
    }

    const result = await prisma.booking.updateMany({
      where: { OR: [{ id: String(id) }, { calendlyEventUri: String(id) }] },
      data: {
        ...(status ? { status: normalizeBookingStatus(status) } : {}),
        ...(notes !== undefined ? { notes: String(notes).trim() } : {}),
        updatedAt: new Date(),
      },
    });

    // A write that matched nothing is not a success.
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found', id });
    }

    return res.json({ success: true, updated: result.count, message: 'Booking updated successfully' });
  } catch (error) {
    console.error('[Admin Status Update Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to update booking status' });
  }
});

// Delete a booking record
app.delete('/api/admin/bookings/:id', async (req, res) => {
  try {
    const id = String(req.params.id);

    // Suppress the reference so a live Calendly event does not reappear on the
    // next sync, then delete the stored row. Both go to Postgres.
    await addDeletedRefs([id]);
    const result = await prisma.booking.deleteMany({
      where: { OR: [{ id }, { calendlyEventUri: id }] },
    });

    scheduledEventsCache.expiresAt = 0;
    return res.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error('[Admin Delete Booking Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to delete booking' });
  }
});

// Clear all test leads, bookings, and active Calendly event references
app.post('/api/admin/clear-all', async (req, res) => {
  try {
    // Suppress every currently-live Calendly event so cleared bookings do not
    // reappear on the next sync.
    const calendlyEvents = await fetchCalendlyScheduledEvents(true);
    const calendlyUris = calendlyEvents.map(e => e.calendlyEventUri || e.id).filter(Boolean);
    await addDeletedRefs(calendlyUris);

    const [bookingsDeleted, leadsDeleted] = await Promise.all([
      prisma.booking.deleteMany({}),
      prisma.lead.deleteMany({}),
    ]);

    scheduledEventsCache.expiresAt = 0;
    return res.json({
      success: true,
      bookingsDeleted: bookingsDeleted.count,
      leadsDeleted: leadsDeleted.count,
      message: 'All data cleared successfully.',
    });
  } catch (err) {
    console.error('[Clear All Error]', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: 'Failed to clear data' });
  }
});

// Clear data month-wise
app.post('/api/admin/clear-month', async (req, res) => {
  try {
    const { yearMonth } = req.body; // e.g. "2026-08" or "2026-07"
    if (!yearMonth) {
      return res.status(400).json({ error: 'yearMonth is required (e.g., 2026-08)' });
    }

    // Month is matched on the stored timestamp rather than by substring-scanning
    // a JSON array. yearMonth is "YYYY-MM".
    const [yearStr, monthStr] = String(yearMonth).split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'yearMonth must be in YYYY-MM format (e.g., 2026-08)' });
    }
    const rangeStart = new Date(Date.UTC(year, month - 1, 1));
    const rangeEnd = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
    const range = { gte: rangeStart, lt: rangeEnd };

    // Suppress the Calendly events in that month so they do not reappear.
    const calendlyEvents = await fetchCalendlyScheduledEvents(true);
    const urisToSuppress = calendlyEvents
      .filter(ev => {
        const d = new Date(ev.scheduledStartTime || ev.createdAt || 0);
        return !isNaN(d.getTime()) && d >= rangeStart && d < rangeEnd;
      })
      .map(ev => ev.calendlyEventUri || ev.id)
      .filter(Boolean);

    const doomed = await prisma.booking.findMany({
      where: { createdAt: range },
      select: { calendlyEventUri: true },
    });
    await addDeletedRefs([
      ...urisToSuppress,
      ...doomed.map(b => b.calendlyEventUri).filter(Boolean),
    ]);

    const [bookingsDeleted, leadsDeleted] = await Promise.all([
      prisma.booking.deleteMany({ where: { createdAt: range } }),
      prisma.lead.deleteMany({ where: { createdAt: range } }),
    ]);

    scheduledEventsCache.expiresAt = 0;
    return res.json({
      success: true,
      bookingsDeleted: bookingsDeleted.count,
      leadsDeleted: leadsDeleted.count,
      message: `Data for ${yearMonth} cleared successfully.`,
    });
  } catch (err) {
    console.error('[Clear Month Error]', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: 'Failed to clear month data' });
  }
});

// Clear selected rows (by array of IDs)
app.post('/api/admin/clear-selected', async (req, res) => {
  try {
    const { ids } = req.body || {}; // Array of lead/booking IDs or URIs
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const clean = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (clean.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    await addDeletedRefs(clean);

    // Match on id OR calendlyEventUri so a row is removed whichever identifier
    // the panel happened to be showing.
    const [bookingsDeleted, leadsDeleted] = await Promise.all([
      prisma.booking.deleteMany({
        where: { OR: [{ id: { in: clean } }, { calendlyEventUri: { in: clean } }] },
      }),
      prisma.lead.deleteMany({ where: { id: { in: clean } } }),
    ]);

    scheduledEventsCache.expiresAt = 0;
    return res.json({
      success: true,
      bookingsDeleted: bookingsDeleted.count,
      leadsDeleted: leadsDeleted.count,
      message: `${bookingsDeleted.count + leadsDeleted.count} item(s) deleted successfully.`,
    });
  } catch (err) {
    console.error('[Clear Selected Error]', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: 'Failed to delete selected items' });
  }
});

// Delete a lead record
app.delete('/api/admin/leads/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const result = await prisma.lead.deleteMany({ where: { id } });
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: 'Lead not found', id });
    }
    return res.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error('[Admin Delete Lead Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to delete lead' });
  }
});

// Read-only JSON export, generated from Postgres.
// Replaces reading data/admin_store.json directly — that file is no longer
// written and its contents are stale by definition.
app.get('/api/admin/export', async (req, res) => {
  try {
    const snapshot = await buildStoreExport();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="amc_export_${Date.now()}.json"`);
    }
    return res.send(JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error('[Admin Export Error]', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: 'Failed to build export' });
  }
});

// Force sync Calendly events and caches
app.post('/api/admin/sync-calendly', async (req, res) => {
  try {
    reloadCalendlyEnv();
    resetCalendlyCaches();
    const liveTz = resolveTimeZone(req.query.tz, process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata');
    const [bookings, availability] = await Promise.all([
      getUnifiedBookings(true),
      buildLiveAvailabilitySnapshot(liveTz)
    ]);
    return res.json({ success: true, count: bookings.length, availability });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to sync with Calendly' });
  }
});

// GET /api/admin/dashboard
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    // Always reload environment and reset caches to fetch live data
    reloadCalendlyEnv();
    resetCalendlyCaches();

    const liveTz = resolveTimeZone(req.query.tz, process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata');
    const includeAvailability = req.query.includeAvailability !== 'false';

    const [bookings, leads, liveAvailability, c1Name, c2Name] = await Promise.all([
      getUnifiedBookings(true),
      getUnifiedLeads(),
      includeAvailability ? buildLiveAvailabilitySnapshot(liveTz) : Promise.resolve(null),
      getCounsellorName('counsellor1'),
      getCounsellorName('counsellor2')
    ]);

    const confirmedCount = bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'ACTIVE').length;
    const pendingCount = bookings.filter(b => b.status === 'PENDING').length;
    const cancelledCount = bookings.filter(b => b.status === 'CANCELLED' || b.status === 'CANCELED').length;

    const dashboard = {
      success: true,
      generatedAt: new Date().toISOString(),
      timezone: liveTz,
      storageMode: prisma ? 'Prisma Postgres + Persistent JSON' : 'Persistent Local Storage (Active)',
      dbConnected: Boolean(prisma),
      calendlyConnected: Boolean(process.env.CALENDLY_API_TOKEN_1 || process.env.CALENDLY_API_TOKEN_2),
      counsellorNames: {
        counsellor1: c1Name,
        counsellor2: c2Name
      },
      metrics: {
        totalBookings: bookings.length,
        confirmedBookings: confirmedCount,
        pendingBookings: pendingCount,
        cancelledBookings: cancelledCount,
        totalLeads: leads.length,
        availableSlotsC1: liveAvailability?.counsellor1?.totalSlots || 0,
        availableSlotsC2: liveAvailability?.counsellor2?.totalSlots || 0,
        totalLiveSlots: (liveAvailability?.counsellor1?.totalSlots || 0) + (liveAvailability?.counsellor2?.totalSlots || 0)
      },
      bookings,
      leads,
      liveAvailability
    };

    return res.json(dashboard);
  } catch (error) {
    console.error('[Admin Dashboard Error]', error);
    return res.status(500).json({ error: error.message || 'Failed to load admin dashboard' });
  }
});

// GET /api/calendly/debug-availability
// Debug endpoint allowing manual side-by-side verification of available vs unavailable dates for both counsellors
app.get('/api/calendly/debug-availability', async (req, res) => {
  reloadCalendlyEnv();
  resetCalendlyCaches();
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });

  const wantsJson = req.query.format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html'));

  if (!wantsJson) {
    return res.sendFile(path.join(__dirname, 'admin.html'));
  }

  try {
    const tzName = resolveTimeZone(req.query.tz, process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata');
    return res.json(await buildLiveAvailabilitySnapshot(tzName));
  } catch (err) {
    console.error('[Debug Availability Error]', err);
    return res.status(500).json({ error: 'Failed to run debug availability audit' });
  }
});

// GET /api/calendly/month-availability endpoint
// Always queries live Calendly REST API in real time across 120 days (4 months)
app.get('/api/calendly/month-availability', async (req, res) => {
  try {
    // Always reload environment and reset caches to fetch live data
    reloadCalendlyEnv();
    resetCalendlyCaches();

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    });

    const tzName = resolveTimeZone(req.query.tz, process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata');
    const counsellorScope = resolveCounsellorScope(req.query.counsellor);

    // allSettled, not all. getAllActiveEventUris throws when a counsellor's
    // Calendly token is rejected, and with Promise.all one bad token 500'd the
    // whole endpoint — taking down availability for the counsellor whose token
    // was perfectly fine. Each counsellor now succeeds or fails on its own.
    const [uriRes1, uriRes2, c1Name, c2Name] = await Promise.all([
      counsellorScope === 'counsellor2' ? Promise.resolve([]) : settle(getAllActiveEventUris('counsellor1')),
      counsellorScope === 'counsellor1' ? Promise.resolve([]) : settle(getAllActiveEventUris('counsellor2')),
      getCounsellorName('counsellor1'),
      getCounsellorName('counsellor2')
    ]);

    const uris1 = unwrapUris(uriRes1);
    const uris2 = unwrapUris(uriRes2);
    const counsellorErrors = collectCounsellorErrors(uriRes1, uriRes2);
    if (counsellorErrors.length > 0) {
      console.warn('[Month Availability] degraded — some counsellors unavailable:',
        counsellorErrors.map(e => `${e.counsellor}: ${e.error}`).join(' | '));
    }

    // Only a total failure is an error. Partial data is served with a flag.
    if (counsellorErrors.length > 0 && uris1.length === 0 && uris2.length === 0) {
      return res.status(502).json({
        success: false,
        error: 'Could not reach Calendly for either counsellor',
        counsellorErrors,
        availableDates: [],
      });
    }

    const now = Date.now();
    const chunks = [
      [new Date(now + 120000).toISOString(), new Date(now + 30 * 86400000).toISOString()],
      [new Date(now + 30 * 86400000 + 1000).toISOString(), new Date(now + 60 * 86400000).toISOString()],
      [new Date(now + 60 * 86400000 + 1000).toISOString(), new Date(now + 90 * 86400000).toISOString()],
      [new Date(now + 90 * 86400000 + 1000).toISOString(), new Date(now + 120 * 86400000).toISOString()]
    ];

    const promises1 = [];
    const promises2 = [];

    chunks.forEach(([sIso, eIso]) => {
      uris1.forEach(uri => promises1.push(fetchAvailability('counsellor1', uri, sIso, eIso)));
      uris2.forEach(uri => promises2.push(fetchAvailability('counsellor2', uri, sIso, eIso)));
    });

    const [res1, res2] = await Promise.all([
      Promise.allSettled(promises1),
      Promise.allSettled(promises2)
    ]);

    const slots1All = res1.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(s => s.status === 'available');
    const slots2All = res2.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(s => s.status === 'available');

    const dateSet = new Set();
    const c1Map = {};
    const c2Map = {};
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit' });

    for (const slot of slots1All) {
      if (slot.start_time) {
        const dStr = formatter.format(new Date(slot.start_time));
        dateSet.add(dStr);
        c1Map[dStr] = (c1Map[dStr] || 0) + 1;
      }
    }

    for (const slot of slots2All) {
      if (slot.start_time) {
        const dStr = formatter.format(new Date(slot.start_time));
        dateSet.add(dStr);
        c2Map[dStr] = (c2Map[dStr] || 0) + 1;
      }
    }

    const availableDates = Array.from(dateSet).sort();
    monthAvailCache = {
      availableDates: availableDates,
      c1Map: c1Map,
      c2Map: c2Map,
      expiresAt: Date.now() + MONTH_CACHE_TTL
    };

    return res.json({
      success: true,
      availableDates: availableDates,
      c1Dates: c1Map,
      c2Dates: c2Map,
      counsellorNames: {
        counsellor1: c1Name,
        counsellor2: c2Name
      },
      // true when at least one counsellor could not be reached, so the dates
      // below are real but incomplete. The frontend surfaces this rather than
      // inventing availability.
      degraded: counsellorErrors.length > 0,
      counsellorErrors,
      cached: false
    });
  } catch (error) {
    console.error('[Month Availability API Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Failed to fetch month availability' });
  }
});

// GET /api/calendly/availability endpoint
app.get('/api/calendly/availability', async (req, res) => {
  try {
    // Always reload environment and reset caches to fetch live data
    reloadCalendlyEnv();
    resetCalendlyCaches();

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    });

    const rawDate = req.query.date;
    const date = normalizeDateStr(rawDate);
    if (!date) {
      return res.status(400).json({ error: 'Invalid date parameter provided' });
    }

    const tzOffset = resolveTzOffset(req.query.tzOffset, process.env.CALENDLY_TIMEZONE_OFFSET || '+05:30');
    const tzName = resolveTimeZone(req.query.tz, process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata');
    const counsellorScope = resolveCounsellorScope(req.query.counsellor);
    const [c1Name, c2Name] = await Promise.all([
      getCounsellorName('counsellor1'),
      getCounsellorName('counsellor2')
    ]);

    // Each counsellor is resolved independently: a rejected token for one must
    // not deny the other's real slots.
    const [uriRes1, uriRes2] = await Promise.all([
      counsellorScope === 'counsellor2' ? Promise.resolve([]) : settle(getAllActiveEventUris('counsellor1')),
      counsellorScope === 'counsellor1' ? Promise.resolve([]) : settle(getAllActiveEventUris('counsellor2')),
    ]);
    const uris1 = unwrapUris(uriRes1);
    const uris2 = unwrapUris(uriRes2);
    const counsellorErrors = collectCounsellorErrors(uriRes1, uriRes2);
    if (counsellorErrors.length > 0) {
      console.warn('[Availability] degraded — some counsellors unavailable:',
        counsellorErrors.map(e => `${e.counsellor}: ${e.error}`).join(' | '));
    }

    if (counsellorErrors.length > 0 && uris1.length === 0 && uris2.length === 0) {
      return res.status(502).json({
        success: false,
        error: 'Could not reach Calendly for either counsellor',
        counsellorErrors,
        timeSlots: [],
      });
    }

    // Build UTC query range from the selected local date in configured timezone offset.
    const { startIso: targetStartIso, endIso: targetEndIso } = getUtcRangeForLocalDate(date, tzOffset);
    let queryStartIso = targetStartIso;

    const minFutureIso = new Date(Date.now() + 120000).toISOString();
    if (queryStartIso < minFutureIso) {
      queryStartIso = minFutureIso;
    }

    const fetchPromises1 = uris1.map(uri => fetchAvailability('counsellor1', uri, queryStartIso, targetEndIso));
    const fetchPromises2 = uris2.map(uri => fetchAvailability('counsellor2', uri, queryStartIso, targetEndIso));

    const [res1, res2] = await Promise.all([
      Promise.allSettled(fetchPromises1),
      Promise.allSettled(fetchPromises2)
    ]);

    let slots1 = res1.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    let slots2 = res2.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzName,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const isSlotOnSelectedLocalDate = (slot) => {
      if (!slot || !slot.start_time) return false;
      return localDateFormatter.format(new Date(slot.start_time)) === date;
    };

    // Guard against timezone-boundary bleed by keeping only slots on selected local date.
    slots1 = slots1.filter(isSlotOnSelectedLocalDate);
    slots2 = slots2.filter(isSlotOnSelectedLocalDate);

    const beforeLunchCounsellors = [];
    const afterLunchCounsellors = [];
    const timeSlotMap = {};

    function processSlots(slots, counsellorId) {
      for (const slot of slots) {
        if (slot.status !== 'available') continue;
        const dateObj = new Date(slot.start_time);
        const rawTimeLabel = formatLocalTime(dateObj, tzName);
        const timeLabel = rawTimeLabel.replace(/\s+/g, ' ').trim();
        const localHour = getLocalHour(dateObj, tzName);
        const localMinute = getLocalMinute(dateObj, tzName);
        const minutesFromMidnight = localHour * 60 + localMinute;

        if (!timeSlotMap[timeLabel]) {
          timeSlotMap[timeLabel] = {
            time: timeLabel,
            minutesFromMidnight: minutesFromMidnight,
            isoStart: slot.start_time,
            localHour: localHour,
            available: true,
            counsellors: [],
            slotUrls: {}
          };
        }

        if (!timeSlotMap[timeLabel].counsellors.includes(counsellorId)) {
          timeSlotMap[timeLabel].counsellors.push(counsellorId);
        }
        if (slot.scheduling_url) {
          timeSlotMap[timeLabel].slotUrls[counsellorId] = slot.scheduling_url;
        }
      }
    }

    processSlots(slots1, 'counsellor1');
    processSlots(slots2, 'counsellor2');

    // Enforce alternate load balancing: check history of last assigned counsellor
    const lastAssigned = await getLastAssignedCounsellor();
    const primaryCounsellor = lastAssigned === 'counsellor1' ? 'counsellor2' : 'counsellor1';
    const secondaryCounsellor = primaryCounsellor === 'counsellor1' ? 'counsellor2' : 'counsellor1';
    console.log(`[Load Balance] Last assigned counsellor: ${lastAssigned || 'NONE'}. Priority assigned to: ${primaryCounsellor}`);

    for (const timeLabel in timeSlotMap) {
      const slotObj = timeSlotMap[timeLabel];
      if (slotObj.counsellors && slotObj.counsellors.length > 1) {
        slotObj.counsellors = [primaryCounsellor, secondaryCounsellor];
      }
    }

    for (const slot of slots1) {
      if (slot.status !== 'available') continue;
      const localHour = getLocalHour(new Date(slot.start_time), tzName);
      if (localHour >= 9 && localHour < 13) {
        if (!beforeLunchCounsellors.includes('counsellor1')) beforeLunchCounsellors.push('counsellor1');
      } else if (localHour >= 13 && localHour < 19) {
        if (!afterLunchCounsellors.includes('counsellor1')) afterLunchCounsellors.push('counsellor1');
      }
    }

    for (const slot of slots2) {
      if (slot.status !== 'available') continue;
      const localHour = getLocalHour(new Date(slot.start_time), tzName);
      if (localHour >= 9 && localHour < 13) {
        if (!beforeLunchCounsellors.includes('counsellor2')) beforeLunchCounsellors.push('counsellor2');
      } else if (localHour >= 13 && localHour < 19) {
        if (!afterLunchCounsellors.includes('counsellor2')) afterLunchCounsellors.push('counsellor2');
      }
    }

    const timeSlots = Object.values(timeSlotMap).sort((a, b) => {
      return new Date(a.isoStart) - new Date(b.isoStart);
    });

    let nextAvailable = null;
    if (timeSlots.length === 0) {
      try {
        const lookAheadStartIso = new Date(Date.now() + 120000).toISOString();
        const lookAheadEndIso = new Date(Date.now() + 7 * 86400000).toISOString();

        const [futureRes1, futureRes2] = await Promise.allSettled([
          uris1.length > 0 ? fetchAvailability('counsellor1', uris1[0], lookAheadStartIso, lookAheadEndIso) : Promise.resolve([]),
          uris2.length > 0 ? fetchAvailability('counsellor2', uris2[0], lookAheadStartIso, lookAheadEndIso) : Promise.resolve([])
        ]);

        const f1 = futureRes1.status === 'fulfilled' ? futureRes1.value : [];
        const f2 = futureRes2.status === 'fulfilled' ? futureRes2.value : [];
        const allFuture = [...f1, ...f2].filter(s => s.status === 'available');

        if (allFuture.length > 0) {
          allFuture.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
          const firstFutureDateObj = new Date(allFuture[0].start_time);
          const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit' });
          const firstFutureDateStr = formatter.format(firstFutureDateObj);

          const slotsOnThatDay = allFuture.filter(s => {
            const dStr = formatter.format(new Date(s.start_time));
            return dStr === firstFutureDateStr;
          });

          nextAvailable = {
            date: firstFutureDateStr,
            count: slotsOnThatDay.length,
            formattedDate: new Date(firstFutureDateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          };
        }
      } catch (err) {
        console.warn('[Next Available Date Lookup Failed]', err);
      }
    }

    // Extract primary/earliest slot for Counsellor 1
    let counsellor1Slot = null;
    const availC1 = slots1.filter(s => s.status === 'available').sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    if (availC1.length > 0) {
      const dateObj = new Date(availC1[0].start_time);
      await getEventTypeUri('counsellor1');
      const durationVal = eventTypeCache.counsellor1.duration || 15;
      counsellor1Slot = {
        counsellor: 'counsellor1',
        name: c1Name,
        duration: `${durationVal} min Session`,
        time: formatLocalTime(dateObj, tzName).replace(/\s+/g, ' ').trim(),
        isoStart: availC1[0].start_time,
        available: true,
        schedulingUrl: availC1[0].scheduling_url || process.env.CALENDLY_URL_1
      };
    }

    // Extract primary/earliest slot for Counsellor 2
    let counsellor2Slot = null;
    const availC2 = slots2.filter(s => s.status === 'available').sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    if (availC2.length > 0) {
      const dateObj = new Date(availC2[0].start_time);
      await getEventTypeUri('counsellor2');
      const durationVal = eventTypeCache.counsellor2.duration || 30;
      counsellor2Slot = {
        counsellor: 'counsellor2',
        name: c2Name,
        duration: `${durationVal} min Session`,
        time: formatLocalTime(dateObj, tzName).replace(/\s+/g, ' ').trim(),
        isoStart: availC2[0].start_time,
        available: true,
        schedulingUrl: availC2[0].scheduling_url || process.env.CALENDLY_URL_2
      };
    }

    return res.json({
      success: true,
      date,
      urls: {
        counsellor1: process.env.CALENDLY_URL_1,
        counsellor2: process.env.CALENDLY_URL_2
      },
      counsellor1Slot: counsellor1Slot,
      counsellor2Slot: counsellor2Slot,
      timeSlots: timeSlots,
      counsellorNames: {
        counsellor1: c1Name,
        counsellor2: c2Name
      },
      nextAvailable: nextAvailable,
      degraded: counsellorErrors.length > 0,
      counsellorErrors,
      slots: {
        before_lunch: {
          available: beforeLunchCounsellors.length > 0,
          counsellors: beforeLunchCounsellors
        },
        after_lunch: {
          available: afterLunchCounsellors.length > 0,
          counsellors: afterLunchCounsellors
        }
      }
    });

  } catch (error) {
    console.error('[Availability API Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Internal server error fetching availability' });
  }
});

// GET /api/calendly/check-scheduled endpoint (real-time poll fallback)
app.get('/api/calendly/check-scheduled', async (req, res) => {
  try {
    const sinceTime = req.query.since ? parseInt(req.query.since, 10) : (Date.now() - 120000);
    const phone = req.query.phone ? String(req.query.phone).replace(/\D/g, '').slice(-10) : '';
    const minCreatedAtIso = new Date(sinceTime - 60000).toISOString();

    // Fetch live scheduled events from Calendly, optimized to only pull recent details
    const events = await fetchCalendlyScheduledEvents(true, minCreatedAtIso);

    const match = events.find(ev => {
      const isConfirmed = ev.status === 'CONFIRMED' || ev.status === 'active';
      if (!isConfirmed) return false;
      const createdTime = new Date(ev.createdAt || ev.updatedAt || 0).getTime();
      const isRecent = createdTime >= (sinceTime - 30000);

      if (phone && ev.phone) {
        const evPhone = String(ev.phone).replace(/\D/g, '').slice(-10);
        if (evPhone && evPhone === phone) return true;
      }
      return isRecent;
    });

    if (match) {
      return res.json({
        success: true,
        scheduled: true,
        event: match
      });
    }

    return res.json({ success: true, scheduled: false });
  } catch (error) {
    console.error('[Check Scheduled API Error]', error);
    return res.status(500).json({ success: false, scheduled: false, error: error.message });
  }
});

// POST /api/calendly/confirm endpoint
app.post('/api/calendly/confirm', async (req, res) => {
  try {
    const { eventUri, counsellor, bookingId } = req.body || {};
    console.log('[Calendly Confirm] ──── INCOMING ────');
    console.log('[Calendly Confirm]   eventUri:', eventUri);
    console.log('[Calendly Confirm]   counsellor:', counsellor);
    console.log('[Calendly Confirm]   bookingId:', bookingId);

    if (!eventUri) {
      return res.status(400).json({ error: 'eventUri is required' });
    }

    // Fix: Match counsellor by display name OR ID (frontend sends display name like "Counsellor 2 (Aryan Raj)")
    let token = process.env.CALENDLY_API_TOKEN_1;
    let counsellorIdResolved = 'counsellor1';
    const counsellorStr = String(counsellor || '').toLowerCase();
    if (counsellorStr === 'counsellor2' || counsellorStr.includes('counsellor 2') || counsellorStr.includes('aryan') || counsellorStr.includes('manasvi')) {
      token = process.env.CALENDLY_API_TOKEN_2;
      counsellorIdResolved = 'counsellor2';
      console.log('[Calendly Confirm]   Using Token 2 (Counsellor 2)');
    } else if (counsellorStr === 'counsellor1' || counsellorStr.includes('counsellor 1') || counsellorStr.includes('samir')) {
      token = process.env.CALENDLY_API_TOKEN_1;
      counsellorIdResolved = 'counsellor1';
      console.log('[Calendly Confirm]   Using Token 1 (Counsellor 1)');
    } else if (!token || token.startsWith('your_')) {
      token = process.env.CALENDLY_API_TOKEN_2 || process.env.CALENDLY_API_TOKEN_1;
      counsellorIdResolved = process.env.CALENDLY_API_TOKEN_2 ? 'counsellor2' : 'counsellor1';
      console.log('[Calendly Confirm]   Using fallback token');
    } else {
      console.log('[Calendly Confirm]   Using Token 1 (default)');
    }

    if (!token || token.startsWith('your_')) {
      console.warn('[Calendly Confirm] Token missing or unconfigured');
      return res.status(400).json({
        error: 'Calendly token is missing for the selected counsellor',
        fallback: true
      });
    }

    // Short retry window, not 42 seconds.
    //
    // The event's start_time is available on the first call; only the Google
    // Meet conference link may still be provisioning. Blocking the request for
    // 42s held an Express connection (and a bogus or stale eventUri held it for
    // the full duration) for something the frontend poller and the 2-minute
    // background sweep are already built to resolve.
    const eventResult = await fetchCalendlyEventWithRetry(eventUri, token, CONFIRM_RETRY_MS, CONFIRM_RETRY_INTERVAL_MS);
    const resource = eventResult.resource;
    const invitee = eventResult.invitee || null;

    console.log('[Calendly Confirm]   Calendly resource found:', !!resource);
    console.log('[Calendly Confirm]   Invitee:', invitee ? (invitee.name + ' / ' + invitee.email) : 'NONE');
    console.log('[Calendly Confirm]   googleMeetUrl:', eventResult.googleMeetUrl || 'NONE');
    console.log('[Calendly Confirm]   locationType:', eventResult.locationType);

    if (!resource || !resource.start_time) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled event details not found',
        fallback: true
      });
    }

    if (resource.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: `Booking verification failed: Event status is ${resource.status}`,
        fallback: false
      });
    }

    const googleMeetUrl = eventResult.googleMeetUrl || null;
    const locationType = eventResult.locationType || (googleMeetUrl ? 'google_conference' : 'pending');

    // Get invitee contact info from Calendly
    const inviteeEmail = (invitee && invitee.email) || null;
    const inviteeName = (invitee && invitee.name) || null;
    const inviteePhone = (invitee && invitee.text_reminder_number) || null;

    // Resolve the counsellor name BEFORE touching the database, so no awaited
    // network call sits between reading a record and writing it back. That gap
    // was the one genuine read-modify-write race in this file.
    const resolvedName = await getCounsellorName(counsellorIdResolved);
    const counsellorLabel = `Counsellor ${counsellorIdResolved === 'counsellor1' ? '1' : '2'} (${resolvedName})`;
    const counsellorUrl = counsellorIdResolved === 'counsellor1' ? process.env.CALENDLY_URL_1 : process.env.CALENDLY_URL_2;

    // Step 1: locate the booking this confirmation belongs to.
    let existing = null;
    if (bookingId) {
      existing = await prisma.booking.findUnique({ where: { id: String(bookingId) } });
    }
    if (!existing) {
      existing = await prisma.booking.findUnique({ where: { calendlyEventUri: eventUri } });
    }

    // Step 2: fall back to the most recent unconfirmed intent matching this
    // invitee's contact details. Narrowed by the database rather than by
    // scanning every booking in memory.
    if (!existing && (inviteeEmail || inviteeName || inviteePhone)) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const contactFilters = [];
      if (inviteeEmail) contactFilters.push({ email: { equals: inviteeEmail, mode: 'insensitive' } });
      if (inviteeName) contactFilters.push({ name: { equals: inviteeName, mode: 'insensitive' } });
      if (inviteePhone) {
        const tail = String(inviteePhone).replace(/\D/g, '').slice(-10);
        if (tail) contactFilters.push({ phone: { endsWith: tail } });
      }
      if (contactFilters.length > 0) {
        existing = await prisma.booking.findFirst({
          where: {
            calendlyEventUri: null,
            createdAt: { gte: tenMinutesAgo },
            OR: contactFilters,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          console.log('[Calendly Confirm]   Matched pending intent by contact:', existing.id, existing.name, existing.email);
        }
      }
    }

    console.log('[Calendly Confirm]   Target found:', Boolean(existing), existing ? existing.id : 'will create new');

    const confirmData = {
      calendlyEventUri: eventUri,
      calendlyEventName: resource.name || 'AMC Counselling Session',
      scheduledStartTime: new Date(resource.start_time),
      scheduledEndTime: resource.end_time ? new Date(resource.end_time) : null,
      googleMeetUrl: googleMeetUrl,
      locationType: locationType,
      status: normalizeBookingStatus(resource.status || 'CONFIRMED'),
    };

    let saved;
    if (existing) {
      saved = await prisma.booking.update({
        where: { id: existing.id },
        data: {
          ...confirmData,
          // Never blank out a value we already hold.
          googleMeetUrl: googleMeetUrl || existing.googleMeetUrl,
          scheduledEndTime: confirmData.scheduledEndTime || existing.scheduledEndTime,
          email: existing.email || inviteeEmail || null,
          name: existing.name || inviteeName || null,
          selectedCounsellorId: existing.selectedCounsellorId || counsellorIdResolved,
          selectedCounsellor: existing.selectedCounsellor || counsellorLabel,
          selectedCounsellorUrl: existing.selectedCounsellorUrl || counsellorUrl,
        },
      });
    } else {
      // Atomic upsert keyed on the unique event uri: two confirmations racing
      // for the same Calendly event converge on one row.
      saved = await prisma.booking.upsert({
        where: { calendlyEventUri: eventUri },
        update: confirmData,
        create: {
          ...confirmData,
          name: inviteeName || null,
          email: inviteeEmail || null,
          notes: 'Confirmed from Calendly verification',
          selectedCounsellorId: counsellorIdResolved,
          selectedCounsellor: counsellorLabel,
          selectedCounsellorUrl: counsellorUrl,
        },
      });
    }

    console.log('[Calendly Confirm]   Saved: id=' + saved.id + ', email=' + saved.email + ', name=' + saved.name + ', meetUrl=' + (saved.googleMeetUrl ? 'YES' : 'NONE'));

    scheduledEventsCache.expiresAt = 0;

    // Send booking confirmation email with Google Meet link (does not block the response).
    if (saved.googleMeetUrl && saved.email && !saved.emailSent) {
      console.log('[Calendly Confirm] Triggering booking confirmation email for', saved.email);
      sendBookingConfirmationEmail({
        id: saved.id,
        email: saved.email,
        name: saved.name || 'Student',
        googleMeetUrl: saved.googleMeetUrl,
        scheduledStartTime: resource.start_time,
        scheduledEndTime: resource.end_time,
        selectedCounsellor: saved.selectedCounsellor,
        calendlyEventName: resource.name || saved.calendlyEventName || 'AMC Counselling Session',
        timezone: saved.timezone,
      }).then(function (emailResult) {
        if (!emailResult.sent) return;
        // Scoped update — no whole-file rewrite, so nothing else can be clobbered.
        return prisma.booking.update({
          where: { id: saved.id },
          data: { emailSent: true, emailSentAt: new Date() },
        }).then(function () {
          console.log('[Calendly Confirm] emailSent flag saved for booking', saved.id);
        });
      }).catch(function (err) {
        console.error('[Calendly Confirm] Email/flag error:', err && err.stack ? err.stack : err);
      });
    } else if (!googleMeetUrl) {
      console.log('[Calendly Confirm] Meet URL pending — confirmation email will send when link resolves via background sweep');
    } else if (!saved.email) {
      console.warn('[Calendly Confirm] No email address available — cannot send confirmation email for booking', saved.id);
    }

    return res.json({
      success: true,
      bookingId: saved.id,
      start_time: resource.start_time,
      end_time: resource.end_time,
      name: resource.name,
      status: resource.status,
      googleMeetUrl: saved.googleMeetUrl,
      locationType: saved.locationType
    });

  } catch (error) {
    console.error('[Server Error /api/calendly/confirm]', error && error.stack ? error.stack : error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error verifying booking',
      fallback: true
    });
  }
});

// GET /api/bookings/:id/status endpoint (Lightweight polling endpoint for frontend)
app.get('/api/bookings/:id/status', async (req, res) => {
  try {
    const rawId = decodeURIComponent(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ error: 'id parameter is required' });

    const b = await prisma.booking.findFirst({
      where: {
        OR: [
          { id: rawId },
          { calendlyEventUri: rawId },
          { calendlyEventUri: { endsWith: rawId } }
        ]
      }
    });

    if (!b) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    return res.json({
      success: true,
      id: b.id,
      calendlyEventUri: b.calendlyEventUri,
      status: b.status,
      googleMeetUrl: b.googleMeetUrl || null,
      locationType: b.locationType || (b.googleMeetUrl ? 'google_conference' : 'pending'),
      scheduledStartTime: b.scheduledStartTime,
      preferredDate: b.preferredDate,
      selectedSlot: b.selectedSlot
    });
  } catch (error) {
    console.error('[Booking Status Lookup Error]', error && error.stack ? error.stack : error);
    return res.status(500).json({ error: 'Status check failed' });
  }
});

// ──────────────────────────────────────────────────────
// Periodic background sweep: bookings created in the last hour whose Google
// Meet link has not resolved yet.
//
// Rewritten so that it never holds a snapshot of every booking across awaited
// network calls. It queries the rows it needs, then updates each row
// individually by primary key as it goes. Nothing is rewritten wholesale, so a
// slow sweep cannot clobber a booking made while it was running.
// ──────────────────────────────────────────────────────
let sweepInFlight = false;

async function runPendingMeetSweep() {
  // Re-entrancy guard: if the previous run overran the interval, skip this tick
  // rather than starting a second sweep on top of it.
  if (sweepInFlight) {
    console.log('[Pending Meet Sweep] Previous run still in flight — skipping this tick.');
    return;
  }
  sweepInFlight = true;

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const pendingBookings = await prisma.booking.findMany({
      where: {
        calendlyEventUri: { not: null },
        googleMeetUrl: null,
        createdAt: { gte: oneHourAgo },
        OR: [{ locationType: 'pending' }, { locationType: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (pendingBookings.length === 0) return;

    console.log(`[Pending Meet Sweep] Checking ${pendingBookings.length} pending bookings against Calendly API...`);
    const tokens = [process.env.CALENDLY_API_TOKEN_1, process.env.CALENDLY_API_TOKEN_2]
      .filter(t => t && !t.startsWith('your_'));

    for (const b of pendingBookings) {
      for (const token of tokens) {
        let result;
        try {
          result = await fetchCalendlyEventWithRetry(b.calendlyEventUri, token, 6000, 2000);
        } catch (fetchErr) {
          console.error('[Pending Meet Sweep] Calendly fetch failed for', b.id, '-', fetchErr && fetchErr.message);
          continue;
        }

        if (!result || !result.googleMeetUrl) continue;

        console.log(`[Pending Meet Sweep] Resolved Google Meet link for booking ${b.id}: ${result.googleMeetUrl}`);

        // Conditional write, scoped to this one row.
        //
        // The row was read before a network call that can take seconds, so a
        // confirmation could have resolved the same link in the meantime. The
        // googleMeetUrl: null guard makes Postgres decide: if the field is no
        // longer empty this matches nothing and we leave the winner's value
        // alone, instead of overwriting it on the strength of a stale read.
        let updated;
        try {
          const claimed = await prisma.booking.updateMany({
            where: { id: b.id, googleMeetUrl: null },
            data: {
              googleMeetUrl: result.googleMeetUrl,
              locationType: result.locationType,
            },
          });
          if (claimed.count === 0) {
            console.log('[Pending Meet Sweep] Booking', b.id, 'was already resolved elsewhere — leaving it alone.');
            break;
          }
          updated = await prisma.booking.findUnique({ where: { id: b.id } });
          if (!updated) break;
        } catch (updateErr) {
          console.error('[Pending Meet Sweep] Failed to persist Meet link for', b.id, '-',
            updateErr && updateErr.stack ? updateErr.stack : updateErr);
          break;
        }

        // Send confirmation email for the newly resolved link.
        //
        // Claim the send BEFORE dispatching it. Every process runs its own copy
        // of this sweep, so two of them can hold the same booking with
        // emailSent=false at the same moment and both send. Flipping the flag
        // first, conditionally, means Postgres picks exactly one winner; the
        // loser's updateMany matches nothing and it skips. If the send then
        // fails the claim is released so a later sweep can retry.
        const sweepEmail = updated.email || (result.invitee && result.invitee.email) || null;
        const sweepName = updated.name || (result.invitee && result.invitee.name) || 'Student';

        if (!updated.emailSent && sweepEmail) {
          const claimedEmail = await prisma.booking.updateMany({
            where: { id: updated.id, emailSent: false },
            data: { emailSent: true, emailSentAt: new Date() },
          });

          if (claimedEmail.count === 0) {
            console.log('[Pending Meet Sweep] Confirmation email for', updated.id, 'already claimed elsewhere — skipping.');
          } else {
            let sent = false;
            try {
              console.log('[Pending Meet Sweep] Sending confirmation email to', sweepEmail, 'for booking', updated.id);
              const emailResult = await sendBookingConfirmationEmail({
                id: updated.id,
                email: sweepEmail,
                name: sweepName,
                googleMeetUrl: updated.googleMeetUrl,
                scheduledStartTime: updated.scheduledStartTime,
                selectedCounsellor: updated.selectedCounsellor,
                calendlyEventName: updated.calendlyEventName || 'AMC Counselling Session',
                timezone: updated.timezone,
              });
              sent = Boolean(emailResult && emailResult.sent);
              if (sent) {
                console.log('[Pending Meet Sweep] Confirmation email sent for booking', updated.id);
              } else {
                console.warn('[Pending Meet Sweep] Email not sent for', updated.id, '- reason:',
                  emailResult && emailResult.reason);
              }
            } catch (emailErr) {
              console.error('[Pending Meet Sweep] Email send error for', updated.id, '-',
                emailErr && emailErr.stack ? emailErr.stack : emailErr);
            }

            if (!sent) {
              // Release the claim so a later sweep can try again.
              await prisma.booking.updateMany({
                where: { id: updated.id },
                data: { emailSent: false, emailSentAt: null },
              }).catch(releaseErr => {
                console.error('[Pending Meet Sweep] Could not release email claim for', updated.id, '-',
                  releaseErr && releaseErr.message);
              });
            }
          }
        } else if (!updated.emailSent && !sweepEmail) {
          console.warn('[Pending Meet Sweep] No email address found for booking', updated.id, '— cannot send confirmation');
        }

        break; // resolved with this token; move to the next booking
      }
    }
  } catch (err) {
    console.error('[Pending Meet Sweep Error]', err && err.stack ? err.stack : err);
  } finally {
    sweepInFlight = false;
  }
}

// Sweep every 2 minutes. The .catch is belt-and-braces: runPendingMeetSweep
// already handles its own errors, but an async function handed to setInterval
// with no catch is exactly the shape that kills a process silently.
const sweepTimer = setInterval(() => {
  runPendingMeetSweep().catch(err => {
    console.error('[Pending Meet Sweep] Unhandled sweep failure:', err && err.stack ? err.stack : err);
  });
}, 2 * 60 * 1000);
sweepTimer.unref?.();

const server = app.listen(PORT, () => {
  console.log('──────── SERVER STARTED ────────');
  console.log('  pid        :', process.pid);
  console.log('  time       :', new Date().toISOString());
  console.log('  port       :', PORT);
  console.log('  node       :', process.version);
  console.log('  NODE_ENV   :', process.env.NODE_ENV || '(unset)');
  console.log('  timezone   :', Intl.DateTimeFormat().resolvedOptions().timeZone, '| TZ =', process.env.TZ || '(unset)');
  console.log('  store      : PostgreSQL via Prisma (single source of truth)');
  console.log('────────────────────────────────');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nError: Port ${PORT} is already in use by another process.`);
    console.error(`Tip: Run "Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force" in PowerShell to free port ${PORT}.\n`);
  } else {
    console.error('[Server Error]', err && err.stack ? err.stack : err);
  }
  process.exit(1);
});

// Close the database pool cleanly so a restart does not leave connections behind.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[Shutdown] ${signal} received (pid ${process.pid}) — closing server and database pool.`);
    clearInterval(sweepTimer);
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
    // Do not hang forever if a connection refuses to drain.
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
