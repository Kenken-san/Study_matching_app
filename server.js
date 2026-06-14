import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  upsertUser, getUser, updateProfile, getAllUsers,
  sendConnect, acceptConnect, getConnectionStatus, getConnections, getPending,
  addMessage, getMessages,
  cosineSimilarity, initDummyEmbeddings,
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

async function generateEmbedding(text) {
  if (!GEMINI_API_KEY || !text?.trim()) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-2:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: text.trim() }] } }),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Embedding API error");
    }
    const data = await res.json();
    return data.embedding.values;
  } catch (err) {
    console.error("Embedding error:", err.message);
    return null;
  }
}

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
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ profile: user.profile || {} });
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

  if (genAI) {
    const current = await getUser(req.uid);
    const merged = { ...(current?.profile || {}), ...fields };
    const embeddingText = [
      merged.affiliation,
      (merged.studyFields || []).join(", "),
      merged.goal,
      merged.bio,
    ].filter(Boolean).join(" ");
    if (embeddingText.trim()) {
      fields.embedding = await generateEmbedding(embeddingText);
    }
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

// --- Matching (RAG pipeline) -------------------------------------------------

const matchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

app.post("/api/match", requireSession, async (req, res) => {
  try {
    const cached = matchCache.get(req.uid);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.result);
    }

    const me = await getUser(req.uid);
    if (!me || !me.profile?.profileComplete) {
      return res.status(400).json({ error: "プロフィールを完成させてください" });
    }

    const all = getAllUsers();
    const candidates = all.filter((u) => u.id !== req.uid && u.profile?.profileComplete);

    if (candidates.length === 0) {
      return res.json({ matches: [] });
    }

    // Retrieve: rank by cosine similarity of embeddings
    const ranked = candidates
      .map((u) => ({
        user: u,
        score: cosineSimilarity(me.profile.embedding, u.profile.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    let matches = ranked.map(({ user: u, score }) => ({
      id: u.id,
      nickname: u.profile.nickname,
      affiliation: u.profile.affiliation,
      studyFields: u.profile.studyFields,
      goal: u.profile.goal,
      bio: u.profile.bio,
      similarityScore: Math.round(score * 100),
      insight: null,
    }));

    // Generate: compatibility insights for the top candidates
    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const candidateList = ranked
          .map(({ user: u }, i) =>
            `Candidate ${i + 1} (ID: ${u.id})\nNickname: ${u.profile.nickname}\nAffiliation: ${u.profile.affiliation}\nStudy fields: ${u.profile.studyFields.join(", ")}\nGoal: ${u.profile.goal}\nBio: ${u.profile.bio}`
          )
          .join("\n\n---\n\n");

        const prompt = `あなたはスタディマッチングのアシスタントです。以下の「自分」と候補ユーザーのプロフィールを読み、各候補との相性について1〜2文の洞察を書いてください。

ルール：
- 絵文字を一切使用しないこと
- 洗練された、温かみのあるプロフェッショナルなトーンで日本語で書くこと
- 表面的なタグの一致ではなく、学習スタイル・価値観・感情的なニーズの深い共鳴を読み取ること

【自分のプロフィール】
ニックネーム: ${me.profile.nickname}
所属: ${me.profile.affiliation}
分野: ${me.profile.studyFields.join(", ")}
目標: ${me.profile.goal}
自己紹介: ${me.profile.bio}

【候補ユーザー】
${candidateList}

以下のJSON形式のみで返答してください（コードブロック不要）:
[{"userId": "...", "insight": "..."}, ...]`;

        const geminiRes = await model.generateContent(prompt);
        const raw = geminiRes.response.text().trim()
          .replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(raw);
        for (const item of parsed) {
          const match = matches.find((m) => m.id === item.userId);
          if (match) match.insight = item.insight;
        }
      } catch (err) {
        console.error("Gemini insight error:", err.message);
      }
    }

    const result = { matches };
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

// --- Availability (privacy-preserving shared free time) ----------------------

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
      hasData: myBusy.length > 0 && theirBusy.length > 0,
      privacyNote: "お互いの予定の中身は共有されません。二人とも空いている時間だけを計算しています。",
    });
  } catch (err) {
    console.error("Availability error:", err.message);
    res.status(500).json({ error: "空き時間の計算中にエラーが発生しました" });
  }
});

// --- Google Calendar connect (free/busy only) --------------------------------

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
    await updateProfile(req.uid, { busyBlocks });
    res.json({ ok: true, blockCount: busyBlocks.length });
  } catch (err) {
    console.error("Calendar connect error:", err.message);
    res.status(500).json({ error: "カレンダー連携中にエラーが発生しました" });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  if (genAI) {
    initDummyEmbeddings(generateEmbedding)
      .then(() => console.log("Dummy embeddings ready"))
      .catch((err) => console.error("Embedding init error:", err.message));
  }
});
