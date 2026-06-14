// availability.js
// Privacy-preserving shared-free-time engine.
//
// CORE PRIVACY GUARANTEE:
//   A user's calendar is reduced to anonymous BUSY blocks (start/end only).
//   Event titles, descriptions, attendees, locations are NEVER stored,
//   NEVER passed to Gemini, and NEVER returned to the other user.
//   The only thing that ever crosses between two users is the INTERSECTION
//   of their FREE time — i.e. "you are both free Tue 21:00-22:00".
//
// This file is calendar-source-agnostic. Today the busy blocks come from
// seeded schedules in db.js. To switch to real Google Calendar, you only
// replace getBusyBlocks() with a freebusy.query() call (see the seam at the
// bottom). Nothing else in the app changes.

// ----- model -----------------------------------------------------------------
// A "busy block" is { day: 0-6 (0=Mon), start: "HH:MM", end: "HH:MM" }.
// We work on a recurring weekly grid in the user's local time. This keeps the
// demo simple and is exactly the shape a real freebusy reduction produces once
// you collapse the next 7 days into a weekly template.

const DAYS_JA = ["月", "火", "水", "木", "金", "土", "日"];

// Granularity of the planning grid, in minutes. 30 = half-hour slots.
const SLOT_MINUTES = 30;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES; // 48
const TOTAL_SLOTS = SLOTS_PER_DAY * 7; // 336

// ----- helpers ---------------------------------------------------------------

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function slotIndex(day, hhmm) {
  return day * SLOTS_PER_DAY + Math.floor(hhmmToMinutes(hhmm) / SLOT_MINUTES);
}

// ----- core: build a per-user BUSY bitmap ------------------------------------
// Returns a Uint8Array of length TOTAL_SLOTS where 1 = busy, 0 = free.
// Privacy note: this collapses everything to busy/free. Whatever the event was
// (a date, a doctor's appointment, "secret interview") becomes an opaque 1.

function busyBitmapFromBlocks(busyBlocks) {
  const bitmap = new Uint8Array(TOTAL_SLOTS);
  for (const b of busyBlocks) {
    if (b.day < 0 || b.day > 6) continue;
    const startSlot = slotIndex(b.day, b.start);
    const endMin = hhmmToMinutes(b.end);
    const endSlot = b.day * SLOTS_PER_DAY + Math.ceil(endMin / SLOT_MINUTES);
    for (let s = startSlot; s < endSlot && s < (b.day + 1) * SLOTS_PER_DAY; s++) {
      bitmap[s] = 1;
    }
  }
  return bitmap;
}

// ----- core: intersect two users' FREE time ----------------------------------
// A slot is mutually free only if BOTH bitmaps are 0 there.
// We also let each user constrain to "reasonable" hours so we don't suggest
// 4am sessions unless both are genuinely night owls.

function mutualFreeBitmap(busyA, busyB, opts = {}) {
  const { earliest = "06:00", latest = "24:00" } = opts;
  const earliestMin = hhmmToMinutes(earliest);
  const latestMin = latest === "24:00" ? 24 * 60 : hhmmToMinutes(latest);

  const free = new Uint8Array(TOTAL_SLOTS);
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    const minuteOfDay = (s % SLOTS_PER_DAY) * SLOT_MINUTES;
    const withinHours = minuteOfDay >= earliestMin && minuteOfDay < latestMin;
    free[s] = withinHours && busyA[s] === 0 && busyB[s] === 0 ? 1 : 0;
  }
  return free;
}

// ----- core: turn the free bitmap into human-readable windows ----------------
// Collapses runs of consecutive free slots into windows, keeps only windows
// at least `minMinutes` long (a 30-min sliver isn't a study session).

function freeWindows(freeBitmap, minMinutes = 30) {
  const windows = [];
  for (let day = 0; day < 7; day++) {
    let runStart = null;
    for (let i = 0; i <= SLOTS_PER_DAY; i++) {
      const s = day * SLOTS_PER_DAY + i;
      const isFree = i < SLOTS_PER_DAY && freeBitmap[s] === 1;
      if (isFree && runStart === null) {
        runStart = i;
      } else if (!isFree && runStart !== null) {
        const startMin = runStart * SLOT_MINUTES;
        const endMin = i * SLOT_MINUTES;
        if (endMin - startMin >= minMinutes) {
          windows.push({
            day,
            dayLabel: DAYS_JA[day],
            start: minutesToHHMM(startMin),
            end: minutesToHHMM(endMin),
            minutes: endMin - startMin,
          });
        }
        runStart = null;
      }
    }
  }
  return windows;
}

// ----- public API ------------------------------------------------------------
// Given two users' raw busy blocks, return ONLY the shared free windows.
// This is the single function the rest of the app calls. Note what it does
// NOT return: anything about what either user was busy doing.

export function sharedFreeWindows(busyBlocksA, busyBlocksB, opts = {}) {
  const {
    earliest = "06:00",
    latest = "24:00",
    minMinutes = 30,
    limit = 6,
  } = opts;

  const busyA = busyBitmapFromBlocks(busyBlocksA || []);
  const busyB = busyBitmapFromBlocks(busyBlocksB || []);
  const free = mutualFreeBitmap(busyA, busyB, { earliest, latest });
  const windows = freeWindows(free, minMinutes);

  // Sort by longest first (best for a study session), then by day order.
  windows.sort((a, b) => b.minutes - a.minutes || a.day - b.day);
  return windows.slice(0, limit);
}

// N-way intersection: find slots when ALL group members are free simultaneously.
// Privacy guarantee is identical — only the intersection is ever exposed.
export function groupFreeWindows(allBusyBlocks, opts = {}) {
  const {
    earliest = "06:00",
    latest = "24:00",
    minMinutes = 30,
    limit = 8,
  } = opts;

  const earliestMin = hhmmToMinutes(earliest);
  const latestMin = latest === "24:00" ? 24 * 60 : hhmmToMinutes(latest);
  const bitmaps = (allBusyBlocks || []).map((b) => busyBitmapFromBlocks(b || []));

  const free = new Uint8Array(TOTAL_SLOTS);
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    const minuteOfDay = (s % SLOTS_PER_DAY) * SLOT_MINUTES;
    if (minuteOfDay < earliestMin || minuteOfDay >= latestMin) continue;
    if (bitmaps.every((b) => b[s] === 0)) free[s] = 1;
  }

  const windows = freeWindows(free, minMinutes);
  windows.sort((a, b) => b.minutes - a.minutes || a.day - b.day);
  return windows.slice(0, limit);
}

// Pick the single best slot of a given length inside the shared windows.
// Used to anchor the teaching session at a concrete time.
export function bestSlot(windows, desiredMinutes = 25) {
  // Prefer the earliest-in-week window that can fit the session, so the pair
  // can start soon; fall back to the longest if none fit exactly.
  const fits = windows.filter((w) => w.minutes >= desiredMinutes);
  const pool = fits.length ? fits : windows;
  if (!pool.length) return null;
  // earliest day, then earliest start
  const sorted = [...pool].sort(
    (a, b) => a.day - b.day || a.start.localeCompare(b.start)
  );
  const w = sorted[0];
  const startMin = hhmmToMinutes(w.start);
  const endMin = Math.min(startMin + desiredMinutes, hhmmToMinutes(w.end));
  return {
    day: w.day,
    dayLabel: w.dayLabel,
    start: w.start,
    end: minutesToHHMM(endMin),
    label: `${w.dayLabel} ${w.start}〜${minutesToHHMM(endMin)}`,
  };
}

// ----- THE OAUTH SEAM --------------------------------------------------------
// Today: busy blocks live on the user profile (seeded in db.js).
// To go live with real Google Calendar, implement this function with the
// authorization-code flow + freebusy.query, and have it return the SAME shape
// (array of {day, start, end}). Nothing else in availability.js or the server
// needs to change — the privacy guarantee is identical because freebusy only
// ever returns busy intervals, never event details.
//
// export async function getBusyBlocks(user) {
//   // const calendar = google.calendar({ version: "v3", auth: user.oauthClient });
//   // const res = await calendar.freebusy.query({ requestBody: {
//   //   timeMin, timeMax, items: [{ id: "primary" }],
//   // }});
//   // return collapseToWeeklyTemplate(res.data.calendars.primary.busy);
// }
export function getBusyBlocks(user) {
  return user?.profile?.busyBlocks || [];
}
