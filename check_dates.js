const { CALENDLY_API_TOKEN_1, CALENDLY_URL_1, CALENDLY_API_TOKEN_2, CALENDLY_URL_2 } = require('dotenv').config({ path: './.env' }).parsed;

function getUserUuid(token) {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  return payload.user_uuid;
}

async function getEventTypeUri(token, configUrl) {
  const uuid = getUserUuid(token);
  const userUri = 'https://api.calendly.com/users/' + uuid;
  const response = await fetch('https://api.calendly.com/event_types?user=' + encodeURIComponent(userUri), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await response.json();
  const cleanConfigUrl = configUrl.trim().replace(/\/$/, '').toLowerCase();
  const matched = (data.collection || []).find(et => {
    return et.scheduling_url && et.scheduling_url.trim().replace(/\/$/, '').toLowerCase() === cleanConfigUrl;
  }) || (data.collection ? data.collection[0] : null);
  return matched ? matched.uri : null;
}

async function checkAllDates() {
  console.log('========================================================================================');
  console.log('              📅 CALENDLY LIVE AVAILABILITY AUDIT (COUNSELLOR 1 & 2)');
  console.log('========================================================================================\n');

  const token1 = CALENDLY_API_TOKEN_1;
  const token2 = CALENDLY_API_TOKEN_2;
  const uri1 = await getEventTypeUri(token1, CALENDLY_URL_1);
  const uri2 = await getEventTypeUri(token2, CALENDLY_URL_2);

  const startIso1 = new Date(Date.now() + 120000).toISOString();
  const endIso1 = new Date(Date.now() + 30 * 86400000).toISOString();

  const fetchAvail = async (token, uri) => {
    const url = new URL('https://api.calendly.com/event_type_available_times');
    url.searchParams.set('event_type', uri);
    url.searchParams.set('start_time', startIso1);
    url.searchParams.set('end_time', endIso1);
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json();
    return json.collection || [];
  };

  const [slots1, slots2] = await Promise.all([
    fetchAvail(token1, uri1),
    fetchAvail(token2, uri2)
  ]);

  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  const displayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const dateMap = {};

  // Initialize next 30 days
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const isoDate = formatter.format(d);
    const label = displayFormatter.format(d);
    dateMap[isoDate] = { label, c1: 0, c2: 0 };
  }

  for (const s of slots1) {
    if (s.status === 'available' && s.start_time) {
      const dKey = formatter.format(new Date(s.start_time));
      if (dateMap[dKey]) dateMap[dKey].c1++;
    }
  }

  for (const s of slots2) {
    if (s.status === 'available' && s.start_time) {
      const dKey = formatter.format(new Date(s.start_time));
      if (dateMap[dKey]) dateMap[dKey].c2++;
    }
  }

  console.log(pad('Date (YYYY-MM-DD)', 18) + pad('Day & Date', 24) + pad('Counsellor 1', 15) + pad('Counsellor 2', 15) + pad('Total Slots', 15) + 'Website Status');
  console.log('-'.repeat(105));

  let greenCount = 0;
  let disabledCount = 0;

  for (const [dateStr, info] of Object.entries(dateMap)) {
    const total = info.c1 + info.c2;
    const isAvailable = total > 0;
    const statusText = isAvailable ? '🟢 GREEN (AVAILABLE)' : '❌ GREYED OUT (NO SLOTS)';

    if (isAvailable) greenCount++;
    else disabledCount++;

    console.log(
      pad(dateStr, 18) +
      pad(info.label, 24) +
      pad(String(info.c1) + ' slots', 15) +
      pad(String(info.c2) + ' slots', 15) +
      pad(String(total) + ' total', 15) +
      statusText
    );
  }

  console.log('-'.repeat(105));
  console.log(`\nSUMMARY: Out of next 30 days -> 🟢 ${greenCount} Available (Green) | ❌ ${disabledCount} Unavailable (Greyed Out)\n`);
}

function pad(str, len) {
  return str.padEnd(len, ' ');
}

checkAllDates();
