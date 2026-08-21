# AMC1_Sam — Full Audit

**Date:** 2026-08-21
**Scope:** every source file in the repo, read completely.
**Method:** static reading + local execution. Every claim below is labelled.

| Label | Meaning |
|---|---|
| **CONFIRMED** | I executed something and observed the result. Evidence shown. |
| **LIKELY** | Strong reasoning from code, but not executed. |
| **SPECULATIVE** | Informed guess. Treat as a lead, not a fact. |
| **UNKNOWN** | I could not determine this from here. Says what I'd need. |

---

## 0. HEADLINE

**The root cause is that your laptop never runs the code that breaks.**

```js
// server.js:33-34
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
const prisma = hasDatabaseUrl ? new PrismaClient() : null;
```

`DATABASE_URL` is **absent from your local `.env`** (CONFIRMED — the file contains
`PORT`, `CALENDLY_API_TOKEN_1/2`, `CALENDLY_URL_1/2`, `CALENDLY_TIMEZONE`,
`CALENDLY_TIMEZONE_OFFSET`, `BREVO_API_KEY`, and nothing else).

So on your laptop `prisma === null`, and **all 13 `if (prisma)` blocks in
server.js are skipped entirely.** The app is a clean single-store JSON app.

On the server `DATABASE_URL` is set, so all 13 blocks execute and the app becomes a
**dual-store app whose two stores disagree**.

This is not a subtle environment difference. It is a different program.

I reproduced the live bug on this laptop by setting `DATABASE_URL` and changing
nothing else. See §6.

---

## 1. INVENTORY

### 1.1 Express routes

| Method | Path | Reads | Writes |
|---|---|---|---|
| POST | `/api/admin/leads` | JSON store | JSON store + `prisma.lead.create` |
| POST | `/api/admin/bookings/intent` | JSON store | JSON store + `prisma.booking.create` |
| POST | `/api/admin/bookings/confirm` | JSON store | JSON store + `prisma.booking.create/update` |
| POST | `/api/admin/bookings/status` | JSON store | JSON store + `prisma.booking.updateMany` |
| DELETE | `/api/admin/bookings/:id` | JSON store | JSON store + `prisma.booking.deleteMany` |
| POST | `/api/admin/clear-all` | JSON store, Calendly | JSON store + deletes ALL bookings & leads |
| POST | `/api/admin/clear-month` | JSON store, Calendly | JSON store + `deleteMany` by id |
| POST | `/api/admin/clear-selected` | JSON store | JSON store + `deleteMany` by id |
| DELETE | `/api/admin/leads/:id` | JSON store | JSON store + `prisma.lead.deleteMany` |
| POST | `/api/admin/sync-calendly` | Calendly | resets all caches |
| GET | `/api/admin/dashboard` | JSON store, DB, Calendly | resets all caches |
| GET | `/api/calendly/debug-availability` | Calendly | resets all caches |
| GET | `/api/calendly/month-availability` | Calendly | resets caches, writes `monthAvailCache` |
| GET | `/api/calendly/availability` | Calendly, JSON store | resets all caches |
| GET | `/api/calendly/check-scheduled` | Calendly | writes throttle cache |
| POST | `/api/calendly/confirm` | Calendly, JSON store | JSON store + DB + sends email |
| GET | `/api/bookings/:id/status` | JSON store, DB | none |

Static: `express.static(__dirname)` serves the whole repo root.

### 1.2 Feature list (the Phase 3 test checklist)

**Public:** entry lead modal (name/email/phone/source, "Other" free text, country-code
picker with search); VSL video (autoplay/mute/unmute/play-pause); 5-stage accordion;
custom calendar with live availability; time-slot picker grouped Morning/Afternoon/
Evening; counsellor load-balancing; Calendly modal (iframe + postMessage listener +
5s polling fallback); booking confirmation card; Google Meet link polling (12×5s);
confirmation email; proof carousel (3D desktop / marquee mobile) + lightbox + filters;
terms modal; sticky CTA.

**Admin (`admin.html`):** dashboard metrics; bookings table; leads table; status
change; notes edit; delete booking; delete lead; clear-all; clear-month;
clear-selected; sync-calendly; CSV/export controls; filters; availability panel.

**Audit (`audit.html`):** availability debug view.

### 1.3 Timers and background jobs

| What | Where | Interval |
|---|---|---|
| `runPendingMeetSweep` | server.js:2515 | every 2 min, **per process** |
| Google Meet link polling | js/main.js:806 | every 5s, max 12 attempts |
| Calendly scheduled poll | js/main.js:1280 | every 5s, starts 10s after modal opens |
| Carousel autoplay | js/main.js:2006 | every 1.6s |

### 1.4 Module-level mutable state (all **per-process**, none shared)

| Variable | server.js | TTL | Reset on every request to |
|---|---|---|---|
| `eventTypeCache` | :104 | 6 h | dashboard, sync, availability, month-availability, debug |
| `counsellorProfileCache` | :110 | 6 h | same |
| `monthAvailCache` | :116 | 30 min (declared) | same |
| `scheduledEventsCache` | :125 | 1 min declared / **2 min actually set** at :985 | same |
| `recentScheduledThrottleCache` | :851 | 3 s | not reset |

**CONFIRMED:** `resetCalendlyCaches()` is called at the top of `/api/admin/dashboard`
(:1680), `/api/admin/sync-calendly` (:1663), `/api/calendly/debug-availability`
(:1734), `/api/calendly/month-availability` (:1762) and `/api/calendly/availability`
(:1854). **The caches therefore never serve a hit on those paths.** Every availability
request performs a full Calendly fan-out (~12 API calls: 2 × event_types, 2 × user
profile, 8 × available_times).

`SCHEDULED_EVENTS_CACHE_TTL` (:129) is declared and **never used** — the real TTL is
hardcoded to 2 minutes at :985. Dead constant.

### 1.5 Disk I/O

Only `data/admin_store.json`, via `readLocalStore()` (:59) / `writeLocalStore()` (:70).
Both are **synchronous** (`readFileSync` / `writeFileSync`) and rewrite the **entire
file** every time. This matters — see §4.

### 1.6 External APIs

| API | Failure behaviour |
|---|---|
| Calendly `event_types` | **throws** → `Promise.all` rejects → whole endpoint 500s |
| Calendly `event_type_available_times` | 12 s abort timeout; throws; swallowed by `allSettled` → silently empty |
| Calendly `scheduled_events` | logs a warning, continues with partial data |
| Calendly `scheduled_events/{uuid}` | retries for **42 s** (9 × 4.5 s) before giving up |
| Brevo | wrapped in try/catch, returns `{sent:false}`; offline mode logs only |

### 1.7 Env vars referenced in app code

`PORT`, `DATABASE_URL`, `CALENDLY_API_TOKEN_1`, `CALENDLY_API_TOKEN_2`,
`CALENDLY_URL_1`, `CALENDLY_URL_2`, `CALENDLY_TIMEZONE`, `CALENDLY_TIMEZONE_OFFSET`,
`BREVO_API_KEY`.

**`DATABASE_URL` is the only one absent locally.** That single absence is the bug.

---

## 2. FLOW TRACES

### (a) Public booking

```
Calendly iframe fires postMessage 'calendly.event_scheduled'
  └─ js/main.js:1562  window 'message' listener
     └─ js/main.js:1589  handleBookingCompleted(eventUri)
        ├─ js/main.js:1053  closes modal after 850ms
        └─ js/main.js:1060  POST /api/calendly/confirm
           └─ server.js:2134
              ├─ :2175  fetchCalendlyEventWithRetry()  — blocks up to 42s
              ├─ :2209  readLocalStore()
              ├─ :2237  await getCounsellorName()      ← AWAIT INSIDE READ→WRITE
              ├─ :2282  writeLocalStore()
              ├─ :2285  prisma.booking.update / create
              └─ :2331  sendBookingConfirmationEmail()  (fire-and-forget)
        └─ js/main.js:1105  POST /api/admin/bookings/confirm   ← SECOND WRITE
           └─ server.js:1341  readLocalStore → write → prisma
        └─ js/main.js:866  startGoogleMeetPolling()
           └─ GET /api/bookings/:id/status every 5s ×12
              └─ server.js:2379  JSON lookup, falls back to prisma
```

### (b) Lead capture

```
js/main.js:1855  entryForm submit
  └─ :1932  POST /api/admin/leads
     └─ server.js:1212  validate → readLocalStore → unshift → writeLocalStore
        └─ :1244  prisma.lead.create
```

### (c) Admin panel

```
admin.html  →  GET /api/admin/dashboard
  └─ server.js:1676
     ├─ :1679  reloadCalendlyEnv()      ← re-reads .env on EVERY request
     ├─ :1680  resetCalendlyCaches()    ← nukes all caches on EVERY request
     └─ :1685  Promise.all([ getUnifiedBookings(true), getUnifiedLeads(),
                             buildLiveAvailabilitySnapshot(), ... ])
        └─ getUnifiedBookings (:993)
           ├─ :994   readLocalStore()
           ├─ :1014  prisma.booking.findMany({take:300})
           └─ :1018  if (dbBookings.length > 0) localBookings = dbBookings
                     ↑ WHOLESALE REPLACEMENT — discards the JSON copy entirely
```

**Auth: there is none.** No session, no token, no middleware. Every `/api/admin/*`
route is fully public (CONFIRMED, §5.7).

### (d) Background sweep

```
server.js:2515  setInterval(runPendingMeetSweep, 120000)   ← per process
  └─ :2430  readLocalStore()                    ← ONE snapshot
     └─ for each pending booking:
        └─ :2450  await fetchCalendlyEventWithRetry(..., 6000, 2000)   ← up to 6s each
           └─ :2457  writeLocalStore(store)     ← writes the STALE snapshot
```

---

## 3. WINDOWS vs LINUX PARITY

| Check | Verdict | Evidence |
|---|---|---|
| **Filename case** | **CLEAR** | CONFIRMED — wrote a checker that indexes every real file with exact case and compares all 25 `src`/`href`/`url()`/`require()`/`sendFile` references byte-for-byte. **0 mismatches.** (6 "missing" hits were false positives: the regex matched `new URL(varName)`.) |
| **Path separators** | **CLEAR** | CONFIRMED — no hardcoded `\`, all paths use `path.join`. |
| **cwd dependence** | **CLEAR** | CONFIRMED — every disk path derives from `__dirname`, not `process.cwd()`. |
| **Line endings** | **CLEAR** | CONFIRMED — all files CRLF, but there are no shell scripts or shebangs, and Node/browsers accept CRLF. Cosmetic only. |
| **Hardcoded hosts** | **CLEAR** | CONFIRMED — only two hits: a startup `console.log` (server.js:2518) and a Calendly `embed_domain` fallback (main.js:1227). Neither affects behaviour. |
| **Timezone** | **ISSUE (minor)** | See §5.8. Most code correctly passes an explicit IANA zone. Two spots don't. |
| **Per-process caches** | **ISSUE (major)** | See §5.3. |
| **Single-process assumption** | **ISSUE (major)** | See §5.2. |
| **Node version** | **UNKNOWN** | Local is v24.15.0. `package.json` declares **no `engines` field**, so the server may run a different major version. I cannot check the server's version from here. |

---

## 4. CONCURRENCY: read-modify-write audit

I scanned every `readLocalStore()` → `writeLocalStore()` pair and listed the `await`s
between them (executed script, output below).

**Genuinely racy — an `await` sits between the read and the write:**

| Handler | read → write | await between |
|---|---|---|
| `/api/admin/clear-all` | :1505 → :1514 | `fetchCalendlyScheduledEvents` (network) |
| `/api/admin/clear-month` | :1540 → :1579 | `fetchCalendlyScheduledEvents` (network) |
| `/api/calendly/confirm` | :2209 → :2282 | `getCounsellorName` (network) |
| `runPendingMeetSweep` | :2430 → :2457 | `fetchCalendlyEventWithRetry` **in a loop, ≤6 s per booking** |

**NOT racy — read, mutate and write are adjacent with no `await` between:**

`/api/admin/bookings/intent` (:1306→:1309), `/api/admin/bookings/confirm`
(:1353→:1385), `/api/admin/bookings/status` (:1442→:1450),
`DELETE /api/admin/bookings/:id` (:1478→:1484), `/api/admin/clear-selected`
(:1609→:1619), `DELETE /api/admin/leads/:id` (:1641→:1643).

### ⚠️ Correction to an earlier claim

Earlier in this session I told you that `/api/admin/bookings/confirm`
(server.js:1354-1391) performs a read-modify-write "with awaited Calendly calls in
between and no locking." **That was wrong.** Its `await`s all occur *after*
`writeLocalStore()`. Because Node is single-threaded and `readFileSync`/`writeFileSync`
are synchronous, that sequence is **atomic within one process**.

The harness confirms it: **50 concurrent booking intents against one process lost
exactly 0 records** (CONFIRMED, `BASELINE.txt`).

The race is real, but it is narrower than I claimed, and — critically — it only bites
**across processes**. See §5.2.

### Sweep re-entrancy

`setInterval(runPendingMeetSweep, 120000)` does not await the previous run. With ~15
pending bookings × up to 6 s of Calendly retry each, one run can exceed 120 s and a
second run starts on top of it, both holding stale snapshots. **LIKELY** (arithmetic
from :2450 and :2515; not executed — I'd need 15+ genuinely-pending bookings to force it).

---

## 5. FINDINGS, RANKED

### 5.1 Dual source of truth, activated only when `DATABASE_URL` is set — **CONFIRMED**

**This is the root cause of "works on my laptop."**

`getUnifiedBookings` (server.js:1012-1020):

```js
if (prisma) {
  const dbBookings = await prisma.booking.findMany({ orderBy:{createdAt:'desc'}, take:300 });
  if (dbBookings && dbBookings.length > 0) {
    localBookings = dbBookings;      // ← discards the JSON copy wholesale
  }
}
```

The Prisma `Booking` model **cannot store six fields the JSON store holds**
(CONFIRMED by comparing `schema.prisma` against the written objects):

> `email`, `selectedCounsellorId`, `leadSource`, `source`, `emailSent`, `emailSentAt`

So the moment the DB has ≥1 row, the admin panel silently loses all six — including
**the student's email address**, which is what the confirmation email is sent to.

**Executed evidence** (same harness, same code, only `DATABASE_URL` differs):

```
Booking email visible in admin
    MODE A (laptop): PASS  email="brute_mt2yp0ol@example.test"
    MODE B (server): FAIL  email=undefined
```

Three further consequences, all CONFIRMED by execution:

**(a) Status silently reverts.** `normalizeBookingStatus` (:172-178) can return
`'COMPLETED'`, but the Prisma enum only allows `PENDING | CONFIRMED | CANCELLED`
(schema.prisma:43-47). Prisma throws, the throw is swallowed by the "non-fatal" catch
(:1462), the API still returns `{success:true}`, and the panel — which reads the DB —
shows the old value.

```
Status -> COMPLETED (enum gap)
    MODE A (laptop): PASS  json=COMPLETED
    MODE B (server): FAIL  db=PENDING, STORES DISAGREE
```

*This is your "I changed it, it worked, then it changed back on its own."*

**(b) The API hands out an ID that isn't in the JSON store.** In
`/api/admin/bookings/intent` the JSON is written at :1309 with `id = 'bk_…'`, then
Prisma creates a row with a **cuid**, then `newBooking.id = created.id` at :1328 —
*after* the file was already written. The response returns the cuid.

```
ID consistency: JSON store
    MODE A (laptop): PASS  found
    MODE B (server): FAIL  NOT FOUND — JSON holds a different id than the API returned
```

**(c) Deletes silently leave orphans.** Because some records carry `bk_…` ids and
others cuids, `clear-selected` deletes by an id that matches only one store.

```
Cleanup removed DB rows
    MODE A (laptop): SKIP (no DB to check)
    MODE B (server): FAIL  3 rows remain after delete
```

### 5.2 Multi-process JSON clobbering — **CONFIRMED (conditional on instances > 1)**

Two server instances sharing one `data/admin_store.json` and one Postgres DB;
40 concurrent booking intents alternating between them:

```
writes accepted by the API : 40 / 40   (every one returned HTTP 200 + a bookingId)
landed in admin_store.json : 26        <-- 14 LOST (35%)
landed in Postgres         : 40        <-- 0 lost
stores agree               : NO — json=26 vs postgres=40
```

Same test, **single** instance: 50/50 landed in both stores, 0 lost.

Node's single thread protects the file *within* a process. Nothing protects it
*between* processes. Each process also runs its **own** 2-minute sweep and its **own**
set of caches.

**UNKNOWN:** whether your server actually runs more than one instance. That is the one
thing that decides whether this fires in production. `pm2 list` / `pm2 describe <app>`
(look at `exec mode` and `instances`) answers it. Note that §5.1 fires with **one**
instance regardless.

### 5.3 One bad Calendly token 500s the entire availability API — **CONFIRMED**

`/api/calendly/month-availability` (:1772-1777) and `/api/calendly/availability`
(:1876-1877) use **`Promise.all`**, which rejects if *any* member rejects.
`getEventTypeUri` **throws** on a non-OK response (:325-328).

Executed against your real tokens:

```
TOKEN_1 -> event_types HTTP 200, 2 event types found
TOKEN_2 -> event_types HTTP 401 {"title":"Unauthenticated","message":"The access token is invalid"}

[Month Availability API Error] Error: Failed to list event types: Status 401
GET /api/calendly/month-availability  ->  HTTP 500   (all 8 concurrent calls, 0 dates)
GET /api/calendly/availability        ->  HTTP 500
```

Counsellor 1's token is perfectly valid, yet **the whole endpoint 500s for both
counsellors.**

The frontend then hides it: `fetchMonthAvailability` falls back to
`fallbackWeekdayDates()` (main.js:493/499) which **fabricates every weekday as
available**. The user picks one of those fake dates, `checkAvailability()` also 500s,
and they see *"No available slots on the selected date."*

**Why this is the intermittency engine:** it isn't only about a dead token. *Any*
transient single-counsellor failure — a 429, a network blip, or the 12-second abort at
:611 firing under load — takes down availability for **both** counsellors, then heals
itself the moment the transient passes. On a laptop with one user, latency is low and
stable and this essentially never fires. On a live VPS serving concurrent visitors,
with caches reset on every request forcing ~12 Calendly calls per page load, it fires
regularly and briefly.

**UNKNOWN:** whether the server's `.env` has the same stale `CALENDLY_API_TOKEN_2`.
Mine is stale *locally*; you said the host's env is correct. Please verify token 2 on
the server — if it's stale there too, this alone is a large share of your symptom.

### 5.4 A stale event URI blocks a connection for 42 seconds — **CONFIRMED**

```
Calendly confirm: unknown event -> HTTP 404 after 40752ms
```

`fetchCalendlyEventWithRetry` (:395) loops for 42 s before giving up (:2175). One
mistimed or duplicate confirm holds an Express connection — and the process's
attention — for 42 s. Under concurrency this is a real resource-exhaustion vector, and
it is invisible with one local user.

### 5.5 No crash handlers — **CONFIRMED (absence), SPECULATIVE (that it fires)**

`grep "process.on(" server.js` → **nothing**. No `unhandledRejection`, no
`uncaughtException`. On Node ≥15 an unhandled rejection terminates the process. A
crash plus a silent pm2 restart looks exactly like "broke for a few seconds, fixed
itself."

I could **not** find a specific unhandled rejection in the main paths — the route
handlers are all try/catch-wrapped, the fire-and-forget email at :2331 does have a
`.catch()`, and `runPendingMeetSweep` wraps its whole body in try/catch. So the
*mechanism* is armed but I have **no evidence it actually fires**. Honest answer: **I
don't know.** `pm2 list` restart counter settles it.

### 5.6 `currentBookingState.bookingId` is never set — **CONFIRMED (by reading)**

```js
// js/main.js:256-265
function postJson(url, payload) { … return { ok: res.ok, data: data }; }

// js/main.js:1484-1487
postJson('/api/admin/bookings/intent', {...}).then(function (intentRes) {
  if (intentRes && intentRes.bookingId) {          // ← always undefined
    currentBookingState.bookingId = intentRes.bookingId;
  }
});
```

`postJson` resolves to `{ok, data}`, so `intentRes.bookingId` is **always undefined**;
it should be `intentRes.data.bookingId`. The booking intent's id is therefore never
carried into `/api/calendly/confirm`, which falls back to the fuzzy
"most recent pending booking matching by email/name/phone" heuristic (:2217-2233).
Under concurrent bookings that heuristic can attach a confirmation **to the wrong
person's booking**.

### 5.7 `/api/admin/*` has no authentication at all — **CONFIRMED**

```
GET /api/admin/dashboard  -> HTTP 200   (no credentials — returns every lead: names, emails, phones)
DELETE /api/admin/bookings/:id -> HTTP 200   (no credentials)
```

Anyone who knows the URL can read your entire lead database or delete bookings. This
is unrelated to the intermittent bug but is the most serious issue in the repo.

### 5.8 Smaller confirmed issues

| # | Issue | Evidence |
|---|---|---|
| a | Every time-slot click creates a **new** PENDING booking row (`handleDateOrTimeSelection` at main.js:425/1516 → POST intent). Clicking 5 slots = 5 rows. | CONFIRMED by reading |
| b | `normalizeDateStr('not-a-date')` returns `'date-NaN-NaN'` instead of `null`, so validation passes and the endpoint 500s later. | CONFIRMED — `Day availability: bad date -> HTTP 500` (expected 400) |
| c | `initCountryCodePicker` is called **twice** for both pickers (main.js:2217-2238 then 2239-2260, identical) — duplicate listeners. | CONFIRMED by reading |
| d | `.gitignore` line 2 is `.envdata/admin_store.json` — two patterns concatenated by a missing newline. Harmless only because `.env` and `data/` appear separately on lines 3 and 6. | CONFIRMED |
| e | `SCHEDULED_EVENTS_CACHE_TTL` (:129) is dead; real TTL hardcoded at :985. | CONFIRMED |
| f | `reloadCalendlyEnv()` re-reads `.env` from disk on **every** dashboard/availability request. | CONFIRMED by reading |
| g | Timezone: `getLocalDateStr` (:687) hardcodes `Asia/Kolkata`; `new Date(str + 'T00:00:00')` at :2018 parses in **process-local** time. Everything else correctly passes an explicit zone. Low impact but fragile. | CONFIRMED by reading |

---

## 6. WHAT I CHECKED AND CLEARED

So you know these were actually looked at, not skipped:

- **Filename case across the whole repo** — executed checker, 0 mismatches.
- **Path separators / `path.join` usage** — clean.
- **cwd dependence** — clean, everything uses `__dirname`.
- **Line endings** — all CRLF, harmless here (no shell scripts).
- **Hardcoded localhost/ports** — only a log line and a Calendly embed param.
- **Single-process write races** — **tested, 0 lost updates at concurrency 50.** The
  original hypothesis was wrong for one process.
- **Postgres under concurrency** — 50/50 and 40/40 rows landed, zero loss, in every
  test. Prisma with scoped `WHERE` clauses is the reliable store here.
- **Hostile input** — 10 000-char strings, emoji/unicode, `<script>`, `'; DROP TABLE`,
  quotes/brackets, malformed JSON, 500-level nested objects: all handled, **no 500s,
  no crash**. Express + Prisma parameterisation hold up.
- **Status endpoint under load** — 40 concurrent reads, all 200, all identical.
- **Dashboard under load** — 5 concurrent loads, identical counts.
- **Double-click confirm** — exactly 1 DB row created, idempotent.
- **Process liveness** — server survived the entire hostile + concurrency suite.

---

## 7. WHAT I COULD NOT CHECK FROM HERE

| Question | How to answer it |
|---|---|
| Does the server run >1 pm2 instance? | `pm2 describe <app>` — read `exec mode` and `instances`. Decides §5.2. |
| Is the pm2 restart counter climbing? | `pm2 list` — the `↺` column. Decides §5.5. |
| Is the server's `CALENDLY_API_TOKEN_2` also stale? | On the server: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CALENDLY_API_TOKEN_2" https://api.calendly.com/users/me` — 401 means stale. Decides how much of §5.3 is live. |
| Does the deploy wipe `data/`? | hPanel → Git → "Deployment actions" box; and `ls -la data/` on the server. |
| Server's Node major version | `node -v` on the server. No `engines` field pins it. |
| Cloudflare edge caching behaviour | `curl -sI https://amc.drguptamd.in/api/bookings/x/status` — look for `cf-cache-status`. |

---

## 8. VERDICT ON THE ORIGINAL HYPOTHESES

| Hypothesis | Verdict |
|---|---|
| Prisma connection-pool exhaustion | **RULED OUT** as described — `prisma` is a proper module-level singleton (:34), instantiated once. No per-request clients. Not the cause. |
| Calendly webhook race | **RULED OUT** — there is no webhook in this codebase. Confirmation is client-triggered. |
| JSON file race, single process | **RULED OUT by execution** — 50 concurrent writes, 0 lost. |
| JSON file race, multiple processes | **CONFIRMED by execution** — 35% write loss with 2 processes. Conditional on instances > 1. |
| Multi-process cache divergence | **CONFIRMED** — caches are per-process module state and are additionally reset on every request. |
| Process crash + silent restart | **UNKNOWN** — no handlers exist (mechanism armed), but no specific unhandled rejection found. Needs the pm2 restart counter. |
| CDN / cache-header staleness | **RULED OUT at the app layer** — `no-store` set globally (:86-91) and confirmed on the wire. Cloudflare edge behaviour still unverified. |
| Timezone mismatch | **MOSTLY CLEARED** — two minor spots (§5.8g), not the cause. |
| **Dual source of truth gated on `DATABASE_URL`** | **CONFIRMED — this is the root cause.** Reproduced locally by setting one env var. |

---

## 9. ARTIFACTS

| File | What it is |
|---|---|
| `tests/brute.js` | 60-check HTTP harness. Runs against any base URL. |
| `BASELINE.txt` | Both runs against the unfixed code + the mode diff + the multi-process result. |
| `AUDIT.md` | This document. |

Reproduce the root cause yourself:

```bash
node tests/brute.js --base http://localhost:3000 --store ./data/admin_store.json
```

then set `DATABASE_URL`, restart, and run it again with `--db "<url>"`. The
`Booking email visible in admin` check flips from PASS to FAIL.

---

# PHASE 6–7 — FIXES AND VERIFICATION

## Result

| | Before | After |
|---|---|---|
| Harness, server mode | 47 PASS / 13 FAIL | **60 PASS / 0 FAIL** |
| Two processes, 40 concurrent writes | 14 lost (35%) in JSON | **0 lost** |
| Availability with a dead counsellor-2 token | HTTP 500, 0 dates | **HTTP 200, 50 dates** (degraded flag) |
| Confirm with a stale event URI | blocked 40.7 s | **6.9 s, HTTP 404** |
| `/api/admin/*` without credentials | HTTP 200, full lead database | **HTTP 401** |
| `GET /data/admin_store.json` | HTTP 200, full lead database | **HTTP 404** |

## Every previously failing check, and what it does now

| Check | Before | After |
|---|---|---|
| Admin API auth | FAIL — public | PASS — 401 |
| Admin delete auth | FAIL — public | PASS — 401 |
| Booking email visible in admin | FAIL — `email=undefined` | PASS — email present |
| Booking.email persisted to DB | FAIL — no column | PASS — column added |
| ID consistency | FAIL — JSON held a different id | PASS — one store, one id |
| Status -> COMPLETED | FAIL — db stayed PENDING | PASS — db reads COMPLETED |
| Cleanup removed DB rows | FAIL — 3 orphans | PASS — 0 remain |
| Month availability | FAIL — HTTP 500 | PASS — HTTP 200, 50 dates |
| Availability repeatability | FAIL — 500,500,500 | PASS — 200,200,200 |
| Availability under concurrency | FAIL — 8/8 empty | PASS — 8/8 identical |
| Day availability | FAIL — HTTP 500 | PASS — HTTP 200 |
| Day availability: bad date | FAIL — HTTP 500 | PASS — HTTP 400 |
| Calendly confirm: unknown event | FAIL — 40.7 s block | PASS — 6.9 s, 404 |

## Regressions found in my own work, and fixed

**NUL bytes → HTTP 500.** Making Postgres the only store surfaced something the
old code had been hiding: PostgreSQL cannot store `U+0000` in a text column
(`22021 invalid byte sequence for encoding UTF8: 0x00`). Previously the JSON
file accepted it and Prisma's failure was swallowed by a non-fatal catch that
still returned HTTP 200. Fixed by stripping NUL from request bodies.
Verified: `"abc\0def"` now returns 200 and stores `abcdef`.

**Sweep still wrote on a stale read.** Found while re-auditing my own diff.
Both of the sweep's writes are now conditional (`googleMeetUrl: null` and
`emailSent: false` guards), so Postgres picks the winner. This also closes a
duplicate-email path that would have appeared with more than one process.

## Verified by execution

- Full harness, 60/60, against instance A **and** against instance B while both
  were running.
- Two processes sharing one database: 40/40 writes landed, 0 lost, legacy JSON
  never written.
- Fail-closed startup: `.env` without `DATABASE_URL` → exit 1, no port bound.
  `.env` without `ADMIN_API_KEY` → exit 1, no port bound. Complete `.env` → starts.
- Admin panel in a real browser: login overlay gates the page (0 rows, metrics
  `--`), login succeeds, 51 rows render, Sync fires `refresh=true`, no console
  errors, no 401s after login. Cookie is invisible to JS (HttpOnly holds).
- All 13 admin actions through the session cookie alone.
- Filename-case check re-run: still 0 mismatches.

## A subtlety worth knowing

`require('@prisma/client')` **auto-loads the `.env` next to
`prisma/schema.prisma`**, before line 7's `require('dotenv').config()` and
before the environment check. This is why an early attempt to test the
fail-closed path by changing the working directory did not work: Prisma had
already injected `DATABASE_URL` from the repo's `.env` regardless of `cwd`.
The guarantee itself holds — proven by removing the key from `.env` — but
the precedence is not obvious.

## Still not verified from here

- Whether the server runs more than one pm2 instance (decides how much of the
  multi-process hazard was firing live).
- Whether the server's `CALENDLY_API_TOKEN_2` is also stale.
- The server's Node major version. `package.json` still declares no `engines`.
- Cloudflare edge caching behaviour on the live domain.
- Real end-to-end Calendly booking with a real invitee: every Calendly test here
  was read-only, plus one non-existent event id. Nothing booked a real slot.
