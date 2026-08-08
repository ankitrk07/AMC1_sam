const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Cache for event type URIs
const eventTypeCache = {
  counsellor1: { uri: null, expiresAt: 0 },
  counsellor2: { uri: null, expiresAt: 0 }
};
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours cache TTL

// Cache for Month Availability to keep response instantaneous
let monthAvailCache = {
  availableDates: [],
  c1Map: {},
  c2Map: {},
  expiresAt: 0
};
const MONTH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache TTL

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
  }) || (data.collection && data.collection.length > 0 ? data.collection[0] : null);

  if (!matched) {
    throw new Error(`Could not find event type matching URL ${configUrl} for ${counsellorId}`);
  }

  cache.uri = matched.uri;
  cache.expiresAt = Date.now() + CACHE_TTL;
  return matched.uri;
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

// Helper to get all active event type URIs for a counsellor
async function getAllActiveEventUris(counsellorId) {
  const token = counsellorId === 'counsellor1' ? process.env.CALENDLY_API_TOKEN_1 : process.env.CALENDLY_API_TOKEN_2;
  if (!token || token.startsWith('your_')) {
    throw new Error(`Configuration missing for ${counsellorId}`);
  }

  const userUuid = getUserUuidFromToken(token);
  if (!userUuid) {
    throw new Error(`Could not extract user UUID for ${counsellorId}`);
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
  const uris = (data.collection || []).filter(e => e.active !== false).map(e => e.uri);
  return uris.length > 0 ? uris : [getEventTypeUri(counsellorId)];
}

// GET /api/calendly/debug-availability
// Debug endpoint allowing manual side-by-side verification of available vs unavailable dates for both counsellors
app.get('/api/calendly/debug-availability', async (req, res) => {
  const wantsJson = req.query.format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html'));
  
  if (!wantsJson) {
    return res.sendFile(path.join(__dirname, 'audit.html'));
  }

  try {
    const tzName = process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata';
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
    for (const s of slots1) {
      if (s.start_time) {
        const dKey = formatter.format(new Date(s.start_time));
        c1Map[dKey] = (c1Map[dKey] || 0) + 1;
      }
    }

    const c2Map = {};
    for (const s of slots2) {
      if (s.start_time) {
        const dKey = formatter.format(new Date(s.start_time));
        c2Map[dKey] = (c2Map[dKey] || 0) + 1;
      }
    }

    return res.json({
      success: true,
      counsellor1: {
        id: 'counsellor1',
        name: 'Counsellor 1 (Harsh Raj)',
        url: process.env.CALENDLY_URL_1,
        totalSlots: slots1.length,
        availableDates: c1Map
      },
      counsellor2: {
        id: 'counsellor2',
        name: 'Counsellor 2 (Aryan Raj)',
        url: process.env.CALENDLY_URL_2,
        totalSlots: slots2.length,
        availableDates: c2Map
      }
    });
  } catch (err) {
    console.error('[Debug Availability Error]', err);
    return res.status(500).json({ error: 'Failed to run debug availability audit' });
  }
});

// GET /api/calendly/month-availability endpoint
// Always queries live Calendly REST API in real time across 120 days (4 months)
app.get('/api/calendly/month-availability', async (req, res) => {
  try {
    const tzName = process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata';
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
    const rawDate = req.query.date;
    const date = normalizeDateStr(rawDate);
    if (!date) {
      return res.status(400).json({ error: 'Invalid date parameter provided' });
    }

    const tzOffset = process.env.CALENDLY_TIMEZONE_OFFSET || '+05:30';
    const tzName = process.env.CALENDLY_TIMEZONE || 'Asia/Kolkata';

    const uris1 = await getAllActiveEventUris('counsellor1');
    const uris2 = await getAllActiveEventUris('counsellor2');

    // Query 24-hour UTC span for the target date to capture all event schedules
    const targetStartIso = `${date}T00:00:00.000Z`;
    const targetEndIso = `${date}T23:59:59.000Z`;
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
          getEventTypeUri('counsellor1').then(uri => fetchAvailability('counsellor1', uri, lookAheadStartIso, lookAheadEndIso)),
          getEventTypeUri('counsellor2').then(uri => fetchAvailability('counsellor2', uri, lookAheadStartIso, lookAheadEndIso))
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
        name: 'Counsellor 1 (Harsh Raj)',
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
        name: 'Counsellor 2 (Aryan Raj)',
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

// POST /api/calendly/confirm endpoint
app.post('/api/calendly/confirm', async (req, res) => {
  try {
    const { eventUri, counsellor } = req.body;
    if (!eventUri) {
      return res.status(400).json({ error: 'eventUri is required' });
    }

    let token = process.env.CALENDLY_API_TOKEN_1;
    if (counsellor === 'counsellor2') {
      token = process.env.CALENDLY_API_TOKEN_2;
    }

    if (!token || token.startsWith('your_')) {
      console.warn('[Calendly API Warning] Token for verifying counsellor booking is missing or unconfigured');
      return res.status(400).json({
        error: 'Calendly token is missing for the selected counsellor',
        fallback: true
      });
    }

    const uuid = eventUri.split('/').filter(Boolean).pop();
    const calendlyApiUrl = `https://api.calendly.com/scheduled_events/${uuid}`;

    const response = await fetch(calendlyApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Calendly REST API Error] Status ${response.status}: ${errorText}`);
      return res.status(response.status).json({
        success: false,
        error: `Could not verify scheduling (status ${response.status})`,
        fallback: true
      });
    }

    const data = await response.json();
    const resource = data.resource;

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

    return res.json({
      success: true,
      start_time: resource.start_time,
      end_time: resource.end_time,
      name: resource.name,
      status: resource.status
    });

  } catch (error) {
    console.error('[Server Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error verifying booking',
      fallback: true
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
