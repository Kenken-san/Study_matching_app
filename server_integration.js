// ============================================================================
// SERVER INTEGRATION — paste into server.js
// ============================================================================

// --- 1. ADD THIS IMPORT near the top, with the other imports ---------------

import { sharedFreeWindows, bestSlot, getBusyBlocks } from "./availability.js";

// --- 2. ADD THIS ENDPOINT (anywhere among the other app.* routes) ----------

// POST /api/availability  { targetId: "..." }
// Returns ONLY the shared free windows between the logged-in user and target.
// Never returns either user's busy blocks or any event detail.
app.post("/api/availability", requireSession, async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: "targetId is required" });

    const me = await getUser(req.uid);
    const them = await getUser(targetId);
    if (!me || !them) return res.status(404).json({ error: "User not found" });

    // Privacy boundary: we pull each user's busy blocks INDEPENDENTLY and only
    // ever hand the engine raw blocks. The engine returns the intersection of
    // FREE time. Neither set of busy blocks is ever sent to the client.
    const myBusy = getBusyBlocks(me);
    const theirBusy = getBusyBlocks(them);

    // Reasonable study hours. If you later collect per-user preferred hours,
    // intersect them here. For now, a sane evening-inclusive default.
    const windows = sharedFreeWindows(myBusy, theirBusy, {
      earliest: "06:00",
      latest: "24:00",
      minMinutes: 30,
      limit: 6,
    });

    const slot = bestSlot(windows, 25);

    // privacyNote is shown in the UI to make the guarantee explicit to judges.
    res.json({
      target: { id: them.id, nickname: them.profile?.nickname || "?" },
      windows,         // [{ day, dayLabel, start, end, minutes }]
      bestSlot: slot,  // { dayLabel, start, end, label } | null
      hasData: myBusy.length > 0 && theirBusy.length > 0,
      privacyNote:
        "お互いの予定の中身は共有されません。二人とも空いている時間だけを計算しています。",
    });
  } catch (err) {
    console.error("Availability error:", err.message);
    res.status(500).json({ error: "空き時間の計算中にエラーが発生しました" });
  }
});

// --- 3. SEED SCHEDULES onto the dummy users --------------------------------
// In db.js, import the schedules and attach them in the seeding loop:
//
//   import { DUMMY_SCHEDULES } from "./dummy_schedules.js";
//   ...
//   for (const u of DUMMY_USERS) {
//     u.profile.busyBlocks = DUMMY_SCHEDULES[u.id] || [];
//     users.set(u.id, u);
//     bySub.set(u.google_sub, u.id);
//   }
//
// And add "busyBlocks: []" to emptyProfile() so real users have the field too.
