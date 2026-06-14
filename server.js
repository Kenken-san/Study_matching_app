import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  upsertUser, getUser, updateProfile, getAllUsers,
  sendConnect, acceptConnect, getConnectionStatus, getConnections, getPending,
  addMessage, getMessages,
} from "./db.js";
import { sharedFreeWindows, bestSlot, getBusyBlocks } from "./availability.js";

const {
  GOOGLE_CLIENT_ID,
  SESSION_SECRET,
  GEMINI_API_KEY,
  PORT = 3000,
} = process.env;

if (!GOOGLE_CLIENT_ID || !SESSION_SECRET) {
  throw new Error("Set GOOGLE_CLIENT_ID and SESSION_SECRET in your .env");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// --- auth helper -------------------------------------------------------------

function requireSession(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies.session, SESSION_SECRET);
    req.uid = uid;
    next();
  } catch {
    res.status(401).json({ error: "Not signed in" });
  }
}

// --- Sign in / create account ------------------------------------------------

app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: "Missing credential" });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();

    if (!p.email_verified) {
      return res.status(403).json({ error: "Google email not verified" });
    }

    const user = await upsertUser({
      google_sub: p.sub,
      email: p.email,
      name: p.name,
      picture: p.picture,
    });

    const session = jwt.sign({ uid: user.id }, SESSION_SECRET, { expiresIn: "30d" });
    res.cookie("session", session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ user, isNew: user.isNew });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// --- Config ------------------------------------------------------------------

app.get("/api/config", (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID });
});

// --- Who am I ----------------------------------------------------------------

app.get("/api/me", requireSession, async (req, res) => {
  const user = await getUser(req.uid);
  if (!user) return res.status(401).json({ error: "Not found" });
  res.json({ user });
});

// --- Logout ------------------------------------------------------------------

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

// --- Profile -----------------------------------------------------------------

app.get("/api/profile", requireSession, async (req, res) => {
  const user = await getUser(req.uid);
  res.json({ profile: user?.profile || {} });
});

app.put("/api/profile", requireSession, async (req, res) => {
  const allowed = [
    "nickname", "gender", "birthYear", "affiliation",
    "studyFields", "currentLevel", "goal", "country", "bio",
  ];
  const fields = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  const user = await updateProfile(req.uid, fields);
  if (!user) return res.status(404).json({ error: "User not found" });
  matchCache.delete(req.uid);
  res.json({ profile: user.profile });
});

// --- Users list (for matching pool) ------------------------------------------

app.get("/api/users", requireSession, async (req, res) => {
  const all = getAllUsers();
  // exclude self, return public-safe fields only
  const candidates = all
    .filter((u) => u.id !== req.uid && u.profile?.profileComplete)
    .map((u) => ({
      id: u.id,
      nickname: u.profile.nickname,
      affiliation: u.profile.affiliation,
      studyFields: u.profile.studyFields,
      goal: u.profile.goal,
      bio: u.profile.bio,
      country: u.profile.country,
    }));
  res.json({ users: candidates });
});

// --- Matching ----------------------------------------------------------------

// Simple in-memory cache: key = uid, value = { result, expiresAt }
const matchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Coach cache: key = convKey(uid1,uid2), TTL 30 min
const coachCache = new Map();
const COACH_TTL_MS = 30 * 60 * 1000;

function jaccardScore(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

app.post("/api/match", requireSession, async (req, res) => {
  try {
    // Check cache
    const cached = matchCache.get(req.uid);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.result);
    }

    const me = await getUser(req.uid);
    if (!me || !me.profile?.profileComplete) {
      return res.status(400).json({ error: "プロフィールを完成させてください" });
    }

    const all = getAllUsers();
    const candidates = all.filter(
      (u) => u.id !== req.uid && u.profile?.profileComplete
    );

    if (candidates.length === 0) {
      return res.json({ geminiMatches: [], tagMatches: [] });
    }

    // Tag-only matching (Jaccard)
    const tagMatches = candidates
      .map((u) => ({
        id: u.id,
        nickname: u.profile.nickname,
        affiliation: u.profile.affiliation,
        studyFields: u.profile.studyFields,
        goal: u.profile.goal,
        bio: u.profile.bio,
        tagScore: Math.round(
          jaccardScore(me.profile.studyFields, u.profile.studyFields) * 100
        ),
        reason: null,
        geminiScore: null,
      }))
      .sort((a, b) => b.tagScore - a.tagScore)
      .slice(0, 3);

    // Gemini deep matching
    let geminiMatches = [];
    if (genAI) {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const candidateList = candidates
        .map(
          (u) =>
            `ユーザーID: ${u.id}\nニックネーム: ${u.profile.nickname}\n所属: ${u.profile.affiliation}\n分野: ${u.profile.studyFields.join(", ")}\n目標: ${u.profile.goal}\n自己紹介: ${u.profile.bio}`
        )
        .join("\n\n---\n\n");

      const prompt = `あなたは勉強グループマッチングのAIアシスタントです。
以下の「自分」のプロフィールを読んで、候補ユーザーの中から最も相性の良い3人を選び、それぞれ「なぜ合うか」を1〜2文の温かみのある日本語で説明してください。

タグやキーワードの一致だけでなく、勉強スタイル・価値観・動機・感情的なニーズなど、文章から読み取れる深いレベルの相性を重視してください。

【自分のプロフィール】
ニックネーム: ${me.profile.nickname}
所属: ${me.profile.affiliation}
分野: ${me.profile.studyFields.join(", ")}
目標: ${me.profile.goal}
自己紹介: ${me.profile.bio}

【候補ユーザー一覧】
${candidateList}

以下のJSON形式のみで返答してください（説明文は不要）:
[
  {"userId": "...", "reason": "...（1〜2文）", "score": 数値(0-100)},
  {"userId": "...", "reason": "...（1〜2文）", "score": 数値(0-100)},
  {"userId": "...", "reason": "...（1〜2文）", "score": 数値(0-100)}
]`;

      const geminiRes = await model.generateContent(prompt);
      const text = geminiRes.response.text().trim();

      // parse JSON from Gemini response (strip markdown fences if present)
      const jsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(jsonText);

      geminiMatches = parsed.map((item) => {
        const u = candidates.find((c) => c.id === item.userId);
        return {
          id: item.userId,
          nickname: u?.profile.nickname || "?",
          affiliation: u?.profile.affiliation || "",
          studyFields: u?.profile.studyFields || [],
          goal: u?.profile.goal || "",
          bio: u?.profile.bio || "",
          tagScore: Math.round(
            jaccardScore(me.profile.studyFields, u?.profile.studyFields || []) * 100
          ),
          geminiScore: item.score,
          reason: item.reason,
        };
      });
    } else {
      // Fallback: use tag matching when no Gemini key
      geminiMatches = tagMatches.map((m) => ({
        ...m,
        geminiScore: m.tagScore,
        reason: "（Gemini APIキーが設定されていないため、タグマッチで代替しています）",
      }));
    }

    const result = { geminiMatches, tagMatches };

    // Cache the result
    matchCache.set(req.uid, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json(result);
  } catch (err) {
    console.error("Match error:", err.message);
    res.status(500).json({ error: "マッチング処理中にエラーが発生しました: " + err.message });
  }
});

// --- Connections -------------------------------------------------------------

app.post("/api/connect/:targetId", requireSession, (req, res) => {
  const { targetId } = req.params;
  if (targetId === req.uid) return res.status(400).json({ error: "自分自身には申請できません" });
  const conn = sendConnect(req.uid, targetId);
  res.json({ conn });
});

app.put("/api/connect/:targetId/accept", requireSession, (req, res) => {
  const conn = acceptConnect(req.uid, req.params.targetId);
  if (!conn) return res.status(404).json({ error: "申請が見つかりません" });
  res.json({ conn });
});

app.get("/api/connections", requireSession, (req, res) => {
  res.json({ connections: getConnections(req.uid) });
});

app.get("/api/connections/pending", requireSession, (req, res) => {
  res.json({ pending: getPending(req.uid) });
});

app.get("/api/connections/status/:targetId", requireSession, (req, res) => {
  res.json({ status: getConnectionStatus(req.uid, req.params.targetId) });
});

// --- Messages ----------------------------------------------------------------

app.post("/api/messages/:targetId", requireSession, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "メッセージが空です" });
  const status = getConnectionStatus(req.uid, req.params.targetId);
  if (status !== "accepted") return res.status(403).json({ error: "繋がっていないユーザーにはメッセージできません" });
  const msg = addMessage(req.uid, req.params.targetId, text.trim());
  res.json({ msg });
});

app.get("/api/messages/:targetId", requireSession, (req, res) => {
  const status = getConnectionStatus(req.uid, req.params.targetId);
  if (status !== "accepted") return res.status(403).json({ error: "繋がっていません" });
  res.json({ messages: getMessages(req.uid, req.params.targetId) });
});

// --- AI Study Partner Coach --------------------------------------------------

function convKeyStr(a, b) { return [a, b].sort().join("_"); }

app.post("/api/coach/:targetId", requireSession, async (req, res) => {
  try {
    const { targetId } = req.params;
    const status = getConnectionStatus(req.uid, targetId);
    if (status !== "accepted") return res.status(403).json({ error: "繋がっていません" });

    const cacheKey = convKeyStr(req.uid, targetId);
    const cached = coachCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.result);

    const [me, partner] = await Promise.all([getUser(req.uid), getUser(targetId)]);
    if (!me?.profile?.profileComplete || !partner?.profile?.profileComplete) {
      return res.status(400).json({ error: "プロフィールを完成させてください" });
    }

    let result;

    if (genAI) {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `あなたは勉強パートナーコーチングAIです。
以下の2人のプロフィールを読み、この2人のための具体的な勉強パートナーシッププランと、最初に送るとよいメッセージを生成してください。
タグや分野の一致だけでなく、勉強スタイル・動機・感情的なニーズを深く読み取ってください。

【ユーザーA（あなた）】
ニックネーム: ${me.profile.nickname}
所属: ${me.profile.affiliation}
分野: ${me.profile.studyFields.join(", ")}
目標: ${me.profile.goal}
自己紹介: ${me.profile.bio}

【ユーザーB（相手）】
ニックネーム: ${partner.profile.nickname}
所属: ${partner.profile.affiliation}
分野: ${partner.profile.studyFields.join(", ")}
目標: ${partner.profile.goal}
自己紹介: ${partner.profile.bio}

以下のJSON形式のみで返答してください（他の説明文は不要）:
{
  "compatibility": "（この2人が合う理由を1〜2文。感情・学習スタイルの視点で温かく）",
  "plan": ["（具体的な行動1）", "（具体的な行動2）", "（具体的な行動3）"],
  "firstMessage": "（ユーザーAが相手に送る、自然で温かみのある最初のメッセージ。30〜60文字程度）"
}`;

      const geminiRes = await model.generateContent(prompt);
      const text = geminiRes.response.text().trim();
      const jsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      result = JSON.parse(jsonText);
    } else {
      // Fallback without Gemini
      const shared = me.profile.studyFields.filter((f) => partner.profile.studyFields.includes(f));
      result = {
        compatibility: `${me.profile.nickname}さんと${partner.profile.nickname}さんは${shared.length > 0 ? shared.join("・") + "という共通の分野で" : "同じ目標に向かって"}取り組んでいます。`,
        plan: ["週1回、今週やったことを短く共有する", "わからなかったことを気軽に質問し合う", "お互いの目標の進捗を定期的に確認する"],
        firstMessage: `${partner.profile.nickname}さん、はじめまして！お互い${shared[0] || "勉強"}頑張っていますね。一緒に進められたら嬉しいです！`,
      };
    }

    coachCache.set(cacheKey, { result, expiresAt: Date.now() + COACH_TTL_MS });
    res.json(result);
  } catch (err) {
    console.error("Coach error:", err.message);
    res.status(500).json({ error: "コーチデータの生成に失敗しました: " + err.message });
  }
});

// --- Availability (privacy-preserving shared free time) ----------------------

// POST /api/availability  { targetId: "..." }
// Returns ONLY the shared free windows. Never returns either user's busy
// blocks or any event detail — only the intersection of free time.
app.post("/api/availability", requireSession, async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: "targetId is required" });

    const me = await getUser(req.uid);
    const them = await getUser(targetId);
    if (!me || !them) return res.status(404).json({ error: "User not found" });

    const myBusy = getBusyBlocks(me);
    const theirBusy = getBusyBlocks(them);

    const windows = sharedFreeWindows(myBusy, theirBusy, {
      earliest: "06:00",
      latest: "24:00",
      minMinutes: 30,
      limit: 6,
    });

    const slot = bestSlot(windows, 25);

    res.json({
      target: { id: them.id, nickname: them.profile?.nickname || "?" },
      windows,
      bestSlot: slot,
      hasData: !!(them.profile?.calendarConnected),
      myHasData: !!(me.profile?.calendarConnected),
      privacyNote:
        "お互いの予定の中身は共有されません。二人とも空いている時間だけを計算しています。",
    });
  } catch (err) {
    console.error("Availability error:", err.message);
    res.status(500).json({ error: "空き時間の計算中にエラーが発生しました" });
  }
});

// --- Google Calendar connect (free/busy only) --------------------------------
// Reduces the user's real calendar to anonymous weekly busy blocks and stores
// them on the profile. We never store event titles/details — only busy times.

function localParts(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { weekday: p.weekday, hhmm: `${hour}:${p.minute}` };
}
const DAY_MAP = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function collapseToWeeklyTemplate(busy, timeZone) {
  const blocks = [];
  for (const b of busy) {
    const s = localParts(timeZone, new Date(b.start));
    const e = localParts(timeZone, new Date(b.end));
    if (s.weekday === e.weekday) {
      blocks.push({ day: DAY_MAP[s.weekday], start: s.hhmm, end: e.hhmm });
    } else {
      blocks.push({ day: DAY_MAP[s.weekday], start: s.hhmm, end: "24:00" });
      blocks.push({ day: DAY_MAP[e.weekday], start: "00:00", end: e.hhmm });
    }
  }
  return blocks;
}

// POST /api/calendar/connect  { accessToken, timeZone }
app.post("/api/calendar/connect", requireSession, async (req, res) => {
  try {
    const { accessToken, timeZone = "Asia/Tokyo" } = req.body;
    if (!accessToken) return res.status(400).json({ error: "accessToken required" });

    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const fbRes = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: now.toISOString(),
        timeMax: weekLater.toISOString(),
        timeZone,
        items: [{ id: "primary" }],
      }),
    });
    const data = await fbRes.json();
    if (!fbRes.ok) {
      console.error("FreeBusy error:", JSON.stringify(data));
      return res.status(502).json({ error: "カレンダーの取得に失敗しました" });
    }
    const busy = data.calendars?.primary?.busy || [];
    const busyBlocks = collapseToWeeklyTemplate(busy, timeZone);
    await updateProfile(req.uid, { busyBlocks, calendarConnected: true });
    res.json({ ok: true, blockCount: busyBlocks.length });
  } catch (err) {
    console.error("Calendar connect error:", err.message);
    res.status(500).json({ error: "カレンダー連携中にエラーが発生しました" });
  }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
