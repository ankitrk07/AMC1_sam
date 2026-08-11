const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
const prisma = hasDatabaseUrl ? new PrismaClient() : null;

// Persistent Local Fallback Store
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'admin_store.json');

function ensureDataStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
      const initial = {
        leads: [],
        bookings: [],
        meta: { createdAt: new Date().toISOString(), version: '1.0' }
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[Data Store Init Error]', err);
  }
}
ensureDataStore();

function readLocalStore() {
  try {
    ensureDataStore();
    const content = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(content || '{"leads":[],"bookings":[]}');
  } catch (err) {
    console.error('[Data Store Read Error]', err);
    return { leads: [], bookings: [] };
  }
}

function writeLocalStore(data) {
  try {
    ensureDataStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Data Store Write Error]', err);
    return false;
  }
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure all HTML, JS, CSS, and API requests bypass stale browser caches
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Cache for event type URIs
const eventTypeCache = {
  counsellor1: { uri: null, expiresAt: 0 },
  counsellor2: { uri: null, expiresAt: 0 }
};
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours cache TTL

const counsellorProfileCache = {
  counsellor1: { name: null, email: null, expiresAt: 0 },
  counsellor2: { name: null, email: null, expiresAt: 0 }
};

// Cache for Month Availability to keep response instantaneous
let monthAvailCache = {
  availableDates: [],
  c1Map: {},
  c2Map: {},
  expiresAt: 0
};
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
  eventTypeCache.counsellor1 = { uri: null, expiresAt: 0 };
  eventTypeCache.counsellor2 = { uri: null, expiresAt: 0 };
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

function normalizeBookingStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'CONFIRMED' || raw === 'ACTIVE') return 'CONFIRMED';
  if (raw === 'CANCELLED' || raw === 'CANCELED') return 'CANCELLED';
  if (raw === 'COMPLETED') return 'COMPLETED';
  return 'PENDING';
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

  try {
    const response = await fetch(`https://api.calendly.com/users/${userUuid}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return counsellorId === 'counsellor1' ? 'Counsellor 1' : 'Counsellor 2';
    }

    const data = await response.json();
    const apiName = (data && data.resource && data.resource.name) ? String(data.resource.name).trim() : '';
    const apiEmail = (data && data.resource && data.resource.email) ? String(data.resource.email).trim() : '';
    const resolved = apiName || (counsellorId === 'counsellor1' ? 'Counsellor 1' : 'Counsellor 2');
    counsellorProfileCache[counsellorId] = { name: resolved, email: apiEmail, expiresAt: Date.now() + CACHE_TTL };
    return resolved;
  } catch (err) {
    return counsellorId === 'counsellor1' ? 'Counsellor 1' : 'Counsellor 2';
  }
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

// Isolated Helper: Fetch Calendly scheduled event with retry loop for pending conference details
async function fetchCalendlyEventWithRetry(eventUri, token, maxWaitMs = 42000, intervalMs = 4500) {
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
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    } else if (parts[2].length === 4) {
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);
      let day, month;
      if (p1 > 12) {
        day = String(p1).padStart(2, '0');
        month = String(p2).padStart(2, '0');
      } else if (p2 > 12) {
        month = String(p1).padStart(2, '0');
        day = String(p2).padStart(2, '0');
      } else {
        day = String(p1).padStart(2, '0');
        month = String(p2).padStart(2, '0');
      }
      return `${parts[2]}-${month}-${day}`;
    }
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
  const uris1 = await getAllActiveEventUris('counsellor1');
  const uris2 = await getAllActiveEventUris('counsellor2');

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

  return {
    success: true,
    counsellor1: {
      id: 'counsellor1',
      name: c1Name,
      url: process.env.CALENDLY_URL_1,
      totalSlots: slots1.length,
      availableDates: c1Map
    },
    counsellor2: {
      id: 'counsellor2',
      name: c2Name,
      url: process.env.CALENDLY_URL_2,
      totalSlots: slots2.length,
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

// Get unified bookings from DB / Local Store + Calendly Live
async function getUnifiedBookings(forceRefresh = false) {
  const store = readLocalStore();
  let localBookings = store.bookings || [];
  const leads = await getUnifiedLeads();

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

  if (prisma) {
    try {
      const dbBookings = await prisma.booking.findMany({
        orderBy: { createdAt: 'desc' },
        take: 300
      });
      if (dbBookings && dbBookings.length > 0) {
        localBookings = dbBookings;
      }
    } catch (e) {
      console.warn('[Prisma Bookings Read Warning]', e.message);
    }
  }

  const calendlyEvents = await fetchCalendlyScheduledEvents(forceRefresh);

  // Map to prevent duplicates
  const eventMap = new Map();

  // First add live Calendly events
  for (const ev of calendlyEvents) {
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

// Get unified leads from DB / Local Store
async function getUnifiedLeads() {
  const store = readLocalStore();
  let leads = store.leads || [];

  if (prisma) {
    try {
      const dbLeads = await prisma.lead.findMany({
        orderBy: { createdAt: 'desc' },
        take: 300
      });
      if (dbLeads && dbLeads.length > 0) {
        leads = dbLeads;
      }
    } catch (e) {
      console.warn('[Prisma Leads Read Warning]', e.message);
    }
  }

  return leads;
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

    const newLead = {
      id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name,
      email,
      phone,
      source,
      sourceOther: payload.sourceOther ? String(payload.sourceOther).trim() : null,
      countryCode: payload.countryCode ? String(payload.countryCode).trim() : null,
      createdAt: new Date().toISOString()
    };

    // Save to local store
    const store = readLocalStore();
    store.leads = store.leads || [];
    store.leads.unshift(newLead);
    writeLocalStore(store);

    // Save to Prisma DB if available
    if (prisma) {
      try {
        await prisma.lead.create({
          data: {
            name: newLead.name,
            email: newLead.email,
            phone: newLead.phone,
            source: newLead.source,
            sourceOther: newLead.sourceOther,
            countryCode: newLead.countryCode
          }
        });
      } catch (dbErr) {
        console.warn('[Prisma Lead Save Non-fatal]', dbErr.message);
      }
    }

    return res.json({ success: true, leadId: newLead.id });
  } catch (error) {
    console.error('[Admin Lead Save Error]', error);
    return res.status(500).json({ error: error.message || 'Failed to save lead' });
  }
});

app.post('/api/admin/bookings/intent', async (req, res) => {
  try {
    const payload = req.body || {};
    let email = payload.email ? String(payload.email).trim() : null;
    let leadSource = payload.source ? String(payload.source).trim() : null;
    let sourceOther = payload.sourceOther ? String(payload.sourceOther).trim() : null;

    // Automatic lookup from leads if email not directly supplied
    if (!email && payload.phone) {
      const cleanPhone = String(payload.phone).replace(/\D/g, '').slice(-10);
      const store = readLocalStore();
      const matched = (store.leads || []).find(l => String(l.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone);
      if (matched) {
        email = matched.email;
        if (!leadSource) {
          leadSource = matched.sourceOther ? `${matched.source} (${matched.sourceOther})` : matched.source;
        }
      }
    }

    const newBooking = {
      id: 'bk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: payload.name ? String(payload.name).trim() : null,
      email: email,
      phone: payload.phone ? String(payload.phone).trim() : null,
      countryCode: payload.countryCode ? String(payload.countryCode).trim() : null,
      preferredDate: payload.preferredDate ? String(payload.preferredDate).trim() : null,
      selectedSlot: payload.selectedSlot ? String(payload.selectedSlot).trim() : null,
      selectedCounsellor: payload.selectedCounsellor ? String(payload.selectedCounsellor).trim() : null,
      selectedCounsellorUrl: payload.selectedCounsellorUrl ? String(payload.selectedCounsellorUrl).trim() : null,
      timezone: payload.timezone ? String(payload.timezone).trim() : null,
      leadSource: leadSource || (sourceOther ? `${leadSource} (${sourceOther})` : null),
      notes: payload.notes ? String(payload.notes).trim() : null,
      status: 'PENDING',
      source: 'Website Booking Intent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to local store
    const store = readLocalStore();
    store.bookings = store.bookings || [];
    store.bookings.unshift(newBooking);
    writeLocalStore(store);

    // Save to Prisma DB if available
    if (prisma) {
      try {
        const created = await prisma.booking.create({
          data: {
            name: newBooking.name,
            phone: newBooking.phone,
            countryCode: newBooking.countryCode,
            preferredDate: newBooking.preferredDate,
            selectedSlot: newBooking.selectedSlot,
            selectedCounsellor: newBooking.selectedCounsellor,
            selectedCounsellorUrl: newBooking.selectedCounsellorUrl,
            timezone: newBooking.timezone,
            notes: newBooking.notes,
            status: 'PENDING'
          }
        });
        newBooking.id = created.id;
      } catch (dbErr) {
        console.warn('[Prisma Booking Intent Save Non-fatal]', dbErr.message);
      }
    }

    return res.json({ success: true, bookingId: newBooking.id });
  } catch (error) {
    console.error('[Admin Booking Intent Error]', error);
    return res.status(500).json({ error: error.message || 'Failed to save booking intent' });
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

    const store = readLocalStore();
    store.bookings = store.bookings || [];

    let target = store.bookings.find(b => (bookingId && b.id === bookingId) || (eventUri && b.calendlyEventUri === eventUri));

    if (!target) {
      target = {
        id: bookingId || ('bk_' + Date.now()),
        calendlyEventUri: eventUri,
        calendlyEventName: payload.calendlyEventName ? String(payload.calendlyEventName).trim() : null,
        scheduledStartTime: payload.scheduledStartTime || null,
        scheduledEndTime: payload.scheduledEndTime || null,
        googleMeetUrl: googleMeetUrl,
        locationType: locationType,
        status: normalizeBookingStatus(payload.status || 'CONFIRMED'),
        notes: payload.notes ? String(payload.notes).trim() : 'Confirmed from Calendly',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.bookings.unshift(target);
    } else {
      target.calendlyEventUri = eventUri || target.calendlyEventUri;
      target.calendlyEventName = payload.calendlyEventName ? String(payload.calendlyEventName).trim() : target.calendlyEventName;
      target.scheduledStartTime = payload.scheduledStartTime || target.scheduledStartTime;
      target.scheduledEndTime = payload.scheduledEndTime || target.scheduledEndTime;
      if (googleMeetUrl) target.googleMeetUrl = googleMeetUrl;
      if (locationType) target.locationType = locationType;
      target.status = normalizeBookingStatus(payload.status || 'CONFIRMED');
      target.notes = payload.notes ? String(payload.notes).trim() : target.notes;
      target.updatedAt = new Date().toISOString();
    }

    writeLocalStore(store);

    // Save to Prisma DB if available
    if (prisma) {
      try {
        const where = bookingId ? { id: bookingId } : { calendlyEventUri: eventUri };
        const existing = await prisma.booking.findFirst({ where });

        if (!existing) {
          await prisma.booking.create({
            data: {
              calendlyEventUri: eventUri,
              calendlyEventName: payload.calendlyEventName ? String(payload.calendlyEventName).trim() : null,
              scheduledStartTime: payload.scheduledStartTime ? new Date(payload.scheduledStartTime) : null,
              scheduledEndTime: payload.scheduledEndTime ? new Date(payload.scheduledEndTime) : null,
              googleMeetUrl: googleMeetUrl,
              locationType: locationType,
              status: normalizeBookingStatus(payload.status || 'CONFIRMED'),
              notes: payload.notes ? String(payload.notes).trim() : 'Inserted from confirmation callback'
            }
          });
        } else {
          await prisma.booking.update({
            where: { id: existing.id },
            data: {
              calendlyEventUri: eventUri || existing.calendlyEventUri,
              calendlyEventName: payload.calendlyEventName ? String(payload.calendlyEventName).trim() : existing.calendlyEventName,
              scheduledStartTime: payload.scheduledStartTime ? new Date(payload.scheduledStartTime) : existing.scheduledStartTime,
              scheduledEndTime: payload.scheduledEndTime ? new Date(payload.scheduledEndTime) : existing.scheduledEndTime,
              googleMeetUrl: googleMeetUrl || existing.googleMeetUrl,
              locationType: locationType || existing.locationType,
              status: normalizeBookingStatus(payload.status || 'CONFIRMED'),
              notes: payload.notes ? String(payload.notes).trim() : existing.notes
            }
          });
        }
      } catch (dbErr) {
        console.warn('[Prisma Booking Confirm Non-fatal]', dbErr.message);
      }
    }

    // Force flush scheduled events cache to immediately reflect confirmation
    scheduledEventsCache.expiresAt = 0;

    return res.json({ success: true, bookingId: target.id, googleMeetUrl: target.googleMeetUrl, locationType: target.locationType });
  } catch (error) {
    console.error('[Admin Booking Confirm Error]', error);
    return res.status(500).json({ error: error.message || 'Failed to confirm booking' });
  }
});

// Update booking status or notes manually from admin
app.post('/api/admin/bookings/status', async (req, res) => {
  try {
    const { id, status, notes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const store = readLocalStore();
    store.bookings = store.bookings || [];
    const b = store.bookings.find(item => item.id === id || item.calendlyEventUri === id);

    if (b) {
      if (status) b.status = normalizeBookingStatus(status);
      if (notes !== undefined) b.notes = String(notes).trim();
      b.updatedAt = new Date().toISOString();
      writeLocalStore(store);
    }

    if (prisma) {
      try {
        await prisma.booking.updateMany({
          where: { OR: [{ id: id }, { calendlyEventUri: id }] },
          data: {
            ...(status ? { status: normalizeBookingStatus(status) } : {}),
            ...(notes !== undefined ? { notes: String(notes).trim() } : {})
          }
        });
      } catch (e) {
        console.warn('[Prisma Status Update Non-fatal]', e.message);
      }
    }

    return res.json({ success: true, message: 'Booking updated successfully' });
  } catch (error) {
    console.error('[Admin Status Update Error]', error);
    return res.status(500).json({ error: error.message || 'Failed to update booking status' });
  }
});

// Delete a booking record
app.delete('/api/admin/bookings/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const store = readLocalStore();
    store.bookings = (store.bookings || []).filter(b => b.id !== id && b.calendlyEventUri !== id);
    writeLocalStore(store);

    if (prisma) {
      try {
        await prisma.booking.deleteMany({
          where: { OR: [{ id: id }, { calendlyEventUri: id }] }
        });
      } catch (e) {
        console.warn('[Prisma Delete Booking Non-fatal]', e.message);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to delete booking' });
  }
});

// Delete a lead record
app.delete('/api/admin/leads/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const store = readLocalStore();
    store.leads = (store.leads || []).filter(l => l.id !== id);
    writeLocalStore(store);

    if (prisma) {
      try {
        await prisma.lead.deleteMany({ where: { id: id } });
      } catch (e) {
        console.warn('[Prisma Delete Lead Non-fatal]', e.message);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to delete lead' });
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

    const [bookings, leads, liveAvailability] = await Promise.all([
      getUnifiedBookings(true),
      getUnifiedLeads(),
      includeAvailability ? buildLiveAvailabilitySnapshot(liveTz) : Promise.resolve(null)
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
    const uris1 = counsellorScope === 'counsellor2' ? [] : await getAllActiveEventUris('counsellor1');
    const uris2 = counsellorScope === 'counsellor1' ? [] : await getAllActiveEventUris('counsellor2');

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
      cached: false
    });
  } catch (error) {
    console.error('[Month Availability API Error]', error);
    return res.status(500).json({ error: 'Failed to fetch month availability' });
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

    const uris1 = counsellorScope === 'counsellor2' ? [] : await getAllActiveEventUris('counsellor1');
    const uris2 = counsellorScope === 'counsellor1' ? [] : await getAllActiveEventUris('counsellor2');

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
      counsellor1Slot = {
        counsellor: 'counsellor1',
        name: c1Name,
        duration: '15 min Session',
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
      counsellor2Slot = {
        counsellor: 'counsellor2',
        name: c2Name,
        duration: '30 min Session',
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
    console.error('[Availability API Error]', error);
    return res.status(500).json({ error: 'Internal server error fetching availability' });
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
    if (!eventUri) {
      return res.status(400).json({ error: 'eventUri is required' });
    }

    let token = process.env.CALENDLY_API_TOKEN_1;
    if (counsellor === 'counsellor2') {
      token = process.env.CALENDLY_API_TOKEN_2;
    } else if (!token || token.startsWith('your_')) {
      token = process.env.CALENDLY_API_TOKEN_2 || process.env.CALENDLY_API_TOKEN_1;
    }

    if (!token || token.startsWith('your_')) {
      console.warn('[Calendly API Warning] Token for verifying counsellor booking is missing or unconfigured');
      return res.status(400).json({
        error: 'Calendly token is missing for the selected counsellor',
        fallback: true
      });
    }

    // Call fetch with retry (up to ~42s, checking every ~4.5s)
    const eventResult = await fetchCalendlyEventWithRetry(eventUri, token, 42000, 4500);
    const resource = eventResult.resource;

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

    // Update Local Store
    const store = readLocalStore();
    store.bookings = store.bookings || [];
    let target = store.bookings.find(b => (bookingId && b.id === bookingId) || (eventUri && b.calendlyEventUri === eventUri));

    if (target) {
      target.googleMeetUrl = googleMeetUrl || target.googleMeetUrl || null;
      target.locationType = locationType;
      target.calendlyEventUri = eventUri;
      target.scheduledStartTime = resource.start_time || target.scheduledStartTime;
      target.scheduledEndTime = resource.end_time || target.scheduledEndTime;
      target.calendlyEventName = resource.name || target.calendlyEventName;
      target.status = normalizeBookingStatus(resource.status || 'CONFIRMED');
      target.updatedAt = new Date().toISOString();
    } else {
      target = {
        id: bookingId || ('bk_' + Date.now()),
        calendlyEventUri: eventUri,
        calendlyEventName: resource.name || 'AMC Counselling Session',
        scheduledStartTime: resource.start_time,
        scheduledEndTime: resource.end_time,
        googleMeetUrl: googleMeetUrl,
        locationType: locationType,
        status: normalizeBookingStatus(resource.status || 'CONFIRMED'),
        notes: 'Confirmed from Calendly verification',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.bookings.unshift(target);
    }
    writeLocalStore(store);

    // Update Prisma DB if available
    if (prisma) {
      try {
        const where = bookingId ? { id: bookingId } : { calendlyEventUri: eventUri };
        const existing = await prisma.booking.findFirst({ where });
        if (existing) {
          await prisma.booking.update({
            where: { id: existing.id },
            data: {
              calendlyEventUri: eventUri,
              calendlyEventName: resource.name || existing.calendlyEventName,
              scheduledStartTime: new Date(resource.start_time),
              scheduledEndTime: resource.end_time ? new Date(resource.end_time) : existing.scheduledEndTime,
              googleMeetUrl: googleMeetUrl || existing.googleMeetUrl,
              locationType: locationType || existing.locationType,
              status: normalizeBookingStatus(resource.status || existing.status || 'CONFIRMED'),
              updatedAt: new Date()
            }
          });
        } else {
          await prisma.booking.create({
            data: {
              calendlyEventUri: eventUri,
              calendlyEventName: resource.name || 'AMC Counselling Session',
              scheduledStartTime: new Date(resource.start_time),
              scheduledEndTime: resource.end_time ? new Date(resource.end_time) : null,
              googleMeetUrl: googleMeetUrl,
              locationType: locationType,
              status: normalizeBookingStatus(resource.status || 'CONFIRMED'),
              notes: 'Inserted from verification callback'
            }
          });
        }
      } catch (dbErr) {
        console.warn('[Prisma Booking Verify Save Non-fatal]', dbErr.message);
      }
    }

    scheduledEventsCache.expiresAt = 0;

    return res.json({
      success: true,
      bookingId: target.id,
      start_time: resource.start_time,
      end_time: resource.end_time,
      name: resource.name,
      status: resource.status,
      googleMeetUrl: googleMeetUrl,
      locationType: locationType
    });

  } catch (error) {
    console.error('[Server Error /api/calendly/confirm]', error);
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

    const store = readLocalStore();
    let b = (store.bookings || []).find(item => item.id === rawId || item.calendlyEventUri === rawId || (item.calendlyEventUri && item.calendlyEventUri.endsWith(rawId)));

    if (prisma && (!b || !b.googleMeetUrl)) {
      try {
        const dbBooking = await prisma.booking.findFirst({
          where: {
            OR: [
              { id: rawId },
              { calendlyEventUri: rawId },
              { calendlyEventUri: { contains: rawId } }
            ]
          }
        });
        if (dbBooking) {
          b = Object.assign({}, b || {}, dbBooking);
        }
      } catch (dbErr) {
        console.warn('[Prisma Status Lookup Non-fatal]', dbErr.message);
      }
    }

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
    return res.status(500).json({ error: error.message || 'Status check failed' });
  }
});

// Periodic background sweep worker: checks any bookings created within the last 1 hour
// whose Google Meet link is still pending, querying Calendly REST API
async function runPendingMeetSweep() {
  try {
    const store = readLocalStore();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    const pendingBookings = (store.bookings || []).filter(b => {
      if (!b.calendlyEventUri) return false;
      const createdTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
      const isWithinHour = (now - createdTime) < ONE_HOUR;
      const isPendingMeet = !b.googleMeetUrl && (b.locationType === 'pending' || !b.locationType);
      return isWithinHour && isPendingMeet;
    });

    if (pendingBookings.length === 0) return;

    console.log(`[Pending Meet Sweep] Checking ${pendingBookings.length} pending bookings against Calendly API...`);
    const tokens = [process.env.CALENDLY_API_TOKEN_1, process.env.CALENDLY_API_TOKEN_2].filter(Boolean);

    for (const b of pendingBookings) {
      for (const token of tokens) {
        if (!token || token.startsWith('your_')) continue;
        const result = await fetchCalendlyEventWithRetry(b.calendlyEventUri, token, 6000, 2000);
        if (result && result.googleMeetUrl) {
          b.googleMeetUrl = result.googleMeetUrl;
          b.locationType = result.locationType;
          b.updatedAt = new Date().toISOString();
          console.log(`[Pending Meet Sweep] Successfully resolved Google Meet link for booking ${b.id}: ${b.googleMeetUrl}`);

          writeLocalStore(store);

          if (prisma) {
            try {
              await prisma.booking.updateMany({
                where: { OR: [{ id: b.id }, { calendlyEventUri: b.calendlyEventUri }] },
                data: {
                  googleMeetUrl: b.googleMeetUrl,
                  locationType: b.locationType,
                  updatedAt: new Date()
                }
              });
            } catch (e) {
              console.warn('[Prisma Sweep Update Non-fatal]', e.message);
            }
          }
          break;
        }
      }
    }
  } catch (err) {
    console.error('[Pending Meet Sweep Error]', err);
  }
}

// Sweep every 2 minutes
setInterval(runPendingMeetSweep, 2 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
