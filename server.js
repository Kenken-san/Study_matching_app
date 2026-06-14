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
  createGroup, requestJoinGroup, approveJoinRequest, rejectJoinRequest,
  isGroupMember, getGroups, getGroupsRaw, addGroupMessage, getGroupMessages,
} from "./db.js";
import { sharedFreeWindows, groupFreeWindows, bestSlot, getBusyBlocks } from "./availability.js";

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

// --- Public config (safe to expose) ------------------------------------------

app.get("/api/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// --- Gemini coach: study plan + first message for a matched pair -------------

app.post("/api/coach/:partnerId", requireSession, async (req, res) => {
  try {
    const [me, them] = await Promise.all([getUser(req.uid), getUser(req.params.partnerId)]);
    if (!me || !them) return res.status(404).json({ error: "ユーザーが見つかりません" });

    if (!genAI) {
      return res.json({
        compatibility: "プロフィールを見ると、学習スタイルや目標に共通点がありそうです。",
        plan: ["目標と締め切りを共有する", "週1回の進捗確認を設定する", "お互いの得意分野を活かして教え合う"],
        firstMessage: `こんにちは！${them.profile?.nickname || "さん"}、一緒に勉強しませんか？`,
      });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `あなたはスタディマッチングのコーチです。以下の2人のプロフィールを読み、JSON形式で返答してください。

【自分】
ニックネーム: ${me.profile?.nickname || ""}
分野: ${(me.profile?.studyFields || []).join(", ")}
目標: ${me.profile?.goal || ""}
公開プロフィール: ${me.profile?.publicBio || ""}
非公開メモ: ${me.profile?.privateReality || ""}

【相手】
ニックネーム: ${them.profile?.nickname || ""}
分野: ${(them.profile?.studyFields || []).join(", ")}
目標: ${them.profile?.goal || ""}
公開プロフィール: ${them.profile?.publicBio || ""}

以下のJSON形式のみで返答（コードブロック不要）:
{
  "compatibility": "二人の相性についての1〜2文（温かく前向きに。非公開情報は含めないこと）",
  "plan": ["ステップ1", "ステップ2", "ステップ3"],
  "firstMessage": "最初のメッセージの提案文（相手のニックネームを使って自然に）"
}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim()
      .replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(raw);
    res.json({
      compatibility: parsed.compatibility || "",
      plan: Array.isArray(parsed.plan) ? parsed.plan : [],
      firstMessage: parsed.firstMessage || "",
    });
  } catch (err) {
    console.error("Coach error:", err.message);
    res.status(500).json({ error: "学習プランの生成に失敗しました: " + err.message });
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
    "nickname", "studyFields", "goal", "country",
    "publicBio", "privateReality", "privateAffiliation",
  ];
  const fields = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }

  if (genAI) {
    const current = await getUser(req.uid);
    const merged = { ...(current?.profile || {}), ...fields };
    const embeddingText = [
      merged.privateAffiliation,
      (merged.studyFields || []).join(", "),
      merged.goal,
      merged.publicBio,
      merged.privateReality,
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
      studyFields: u.profile.studyFields,
      goal: u.profile.goal,
      bio: u.profile.publicBio,
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
      return res.json({ geminiMatches: [], tagMatches: [] });
    }

    // Tag-based Jaccard similarity
    function tagScore(fieldsA, fieldsB) {
      const a = new Set(fieldsA || []);
      const b = new Set(fieldsB || []);
      if (!a.size && !b.size) return 0;
      const inter = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      return union ? inter / union : 0;
    }

    // Embedding-ranked top 10 (Gemini matches)
    const ranked = candidates
      .map((u) => ({
        user: u,
        score: cosineSimilarity(me.profile.embedding, u.profile.embedding),
        tScore: tagScore(me.profile.studyFields, u.profile.studyFields),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Tag-ranked top 10
    const tagRanked = [...candidates]
      .map((u) => ({ user: u, tScore: tagScore(me.profile.studyFields, u.profile.studyFields) }))
      .sort((a, b) => b.tScore - a.tScore)
      .slice(0, 10);

    // Build base geminiMatches (insight filled in below)
    let geminiMatches = ranked.map(({ user: u, score, tScore }) => ({
      id: u.id,
      nickname: u.profile.nickname,
      studyFields: u.profile.studyFields || [],
      goal: u.profile.goal,
      publicBio: u.profile.publicBio,
      geminiScore: Math.round(score * 100),
      tagScore: Math.round(tScore * 100),
      reason: null,
    }));

    const tagMatches = tagRanked.map(({ user: u, tScore }) => ({
      id: u.id,
      nickname: u.profile.nickname,
      studyFields: u.profile.studyFields || [],
      goal: u.profile.goal,
      publicBio: u.profile.publicBio,
      tagScore: Math.round(tScore * 100),
    }));

    // Generate: compatibility insights for the top candidates
    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const candidateList = ranked
          .map(({ user: u }, i) =>
            `候補 ${i + 1} (ID: ${u.id})
ニックネーム: ${u.profile.nickname}
分野: ${(u.profile.studyFields || []).join(", ")}
目標: ${u.profile.goal}
公開プロフィール: ${u.profile.publicBio}
【AI用非公開データ】現状/悩み: ${u.profile.privateReality}
非公開所属: ${u.profile.privateAffiliation}`
          )
          .join("\n\n---\n\n");

        const prompt = `あなたはスタディマッチングのアシスタントです。以下の「自分」と候補ユーザーのプロフィールを読み、各候補との相性について1〜2文の洞察を書いてください。

重要なルール：
- 絵文字を一切使用しないこと
- 洗練された、温かみのあるプロフェッショナルなトーンで日本語で書くこと
- 「AI用非公開データ」に記載された情報（現在の所属、現状、悩みなど）は深い心理的・状況的な相性を見抜くためにのみ使用すること
- 出力するinsightフィールドには、非公開データの内容（スコア、悩み、具体的な現状など）を一切漏らしてはならない
- insightは、共通の目標や公開されたビジョンのみに基づいた、前向きで温かい1〜2文にすること

【自分のプロフィール】
ニックネーム: ${me.profile.nickname}
分野: ${(me.profile.studyFields || []).join(", ")}
目標: ${me.profile.goal}
公開プロフィール: ${me.profile.publicBio}
【AI用非公開データ】現状/悩み: ${me.profile.privateReality}
非公開所属: ${me.profile.privateAffiliation}

【候補ユーザー】
${candidateList}

以下のJSON形式のみで返答してください（コードブロック不要）:
[{"userId": "...", "insight": "..."}, ...]`;

        const geminiRes = await model.generateContent(prompt);
        const raw = geminiRes.response.text().trim()
          .replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(raw);
        for (const item of parsed) {
          const match = geminiMatches.find((m) => m.id === item.userId);
          if (match) match.reason = item.insight;
        }
      } catch (err) {
        console.error("Gemini insight error:", err.message);
      }
    }

    const result = { geminiMatches, tagMatches };
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

// --- Groups ------------------------------------------------------------------

app.post("/api/groups", requireSession, (req, res) => {
  const { name, description, tags } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "グループ名は必須です" });
  const group = createGroup(req.uid, name.trim(), description?.trim() || "", tags || []);
  res.json({ group });
});

// Request to join — goes to the creator's pending queue, not an instant join.
app.post("/api/groups/:groupId/join", requireSession, (req, res) => {
  const result = requestJoinGroup(req.uid, req.params.groupId);
  if (!result) return res.status(404).json({ error: "グループが見つかりません" });
  res.json(result); // { group, status: "pending" | "already_member" }
});

// Creator approves a pending requester.
app.put("/api/groups/:groupId/approve/:userId", requireSession, (req, res) => {
  const result = approveJoinRequest(req.uid, req.params.groupId, req.params.userId);
  if (!result) return res.status(404).json({ error: "グループが見つかりません" });
  if (result.error === "not_creator")
    return res.status(403).json({ error: "承認できるのは作成者のみです" });
  if (result.error === "no_such_request")
    return res.status(404).json({ error: "参加申請が見つかりません" });
  res.json({ group: result.group });
});

// Creator rejects a pending requester.
app.put("/api/groups/:groupId/reject/:userId", requireSession, (req, res) => {
  const result = rejectJoinRequest(req.uid, req.params.groupId, req.params.userId);
  if (!result) return res.status(404).json({ error: "グループが見つかりません" });
  if (result.error === "not_creator")
    return res.status(403).json({ error: "操作できるのは作成者のみです" });
  res.json({ group: result.group });
});

app.get("/api/groups", requireSession, (req, res) => {
  res.json({ groups: getGroups(req.uid) });
});

// ── Gemini: suggest groups for the current user ───────────────────────────────
// Why AI here: matching a person to a GROUP is not similarity search. It needs
// reasoning over the user's private situation (struggles, level, schedule) AND
// each group's purpose, then judging fit and articulating WHY — while never
// leaking the private data into the public-facing reason. That is a language
// task an embedding/cosine pipeline cannot do.
app.post("/api/groups/suggest", requireSession, async (req, res) => {
  try {
    const me = await getUser(req.uid);
    if (!me?.profile?.profileComplete) {
      return res.status(400).json({ error: "プロフィールを完成させてください" });
    }

    // Candidate groups: those the user hasn't joined and didn't create.
    const candidates = getGroupsRaw().filter(
      (g) => !g.members.has(req.uid) && g.creatorId !== req.uid
    );

    // Tag-overlap fallback used when no Gemini or on Gemini failure.
    const tagFallback = () => {
      const mine = new Set(me.profile.studyFields || []);
      const ranked = candidates
        .map((g) => ({ g, overlap: (g.tags || []).filter((t) => mine.has(t)).length }))
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 3)
        .map(({ g }) => ({ groupId: g.id, reason: "" }));
      return res.json({ suggestions: ranked, ai: false });
    };

    if (!candidates.length) return res.json({ suggestions: [], ai: false });
    if (!genAI) return tagFallback();

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const groupList = candidates
      .map((g) =>
        `グループ ID: ${g.id}\n名前: ${g.name}\n説明: ${g.description || ""}\nタグ: ${(g.tags || []).join(", ")}\n人数: ${g.members.size}`
      )
      .join("\n\n---\n\n");

    const prompt = `あなたはスタディマッチングのアシスタントです。以下の「ユーザー」に最も合うスタディグループを最大3つ選び、それぞれの推薦理由を1〜2文で書いてください。

重要なルール：
- 絵文字を一切使用しないこと
- 温かみのあるプロフェッショナルなトーンで日本語で書くこと
- 「AI用非公開データ」は相性判断にのみ使い、reason には一切含めないこと
- reason は公開情報とグループの目的のみに基づくこと
- 合うグループが3つ未満なら、合うものだけ返すこと

【ユーザー】
ニックネーム: ${me.profile.nickname || ""}
分野: ${(me.profile.studyFields || []).join(", ")}
目標: ${me.profile.goal || ""}
公開プロフィール: ${me.profile.publicBio || ""}
【AI用非公開データ】現状/悩み: ${me.profile.privateReality || ""}

【候補グループ】
${groupList}

以下のJSON形式のみで返答してください（コードブロック不要）:
[{"groupId": "...", "reason": "..."}, ...]`;

    let parsed;
    try {
      const geminiRes = await model.generateContent(prompt);
      const raw = geminiRes.response.text().trim()
        .replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(raw);
    } catch (geminiErr) {
      console.error("Group suggest Gemini error:", geminiErr.message);
      return tagFallback();
    }

    const validIds = new Set(candidates.map((g) => g.id));
    const suggestions = parsed
      .filter((s) => s?.groupId && validIds.has(s.groupId))
      .slice(0, 3);
    res.json({ suggestions, ai: true });
  } catch (err) {
    console.error("Group suggest error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Group schedule: when is every member free? ────────────────────────────────
app.post("/api/groups/:groupId/availability", requireSession, async (req, res) => {
  try {
    const raw = getGroupsRaw().find((g) => g.id === req.params.groupId);
    if (!raw) return res.status(404).json({ error: "グループが見つかりません" });

    const memberIds = [...raw.members];
    const members = (await Promise.all(memberIds.map((id) => getUser(id)))).filter(Boolean);

    const allBusy = members.map((u) => getBusyBlocks(u));
    const withCalendar = allBusy.filter((b) => b.length > 0).length;

    const windows = groupFreeWindows(allBusy, { earliest: "06:00", latest: "24:00", minMinutes: 30, limit: 8 });
    const slot = bestSlot(windows, 60);

    // Gemini: suggest what the group could study together during the best slot
    let suggestion = null;
    if (genAI && slot && windows.length > 0) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const memberProfiles = members
          .map((u) => `- ${u.profile.nickname || "?"}: 分野=${(u.profile.studyFields || []).join(", ")} 目標=${u.profile.goal || ""}`)
          .join("\n");
        const prompt = `スタディグループのメンバー全員が${slot.label}に空いています。以下のメンバーのプロフィールを読んで、この時間に一緒に取り組むと効果的な学習テーマや活動を1〜2文で提案してください。絵文字なし、日本語で。\n\nメンバー:\n${memberProfiles}`;
        const r = await model.generateContent(prompt);
        suggestion = r.response.text().trim();
      } catch (e) {
        console.error("Group avail Gemini error:", e.message);
      }
    }

    res.json({
      windows,
      bestSlot: slot,
      hasData: withCalendar >= 2,
      memberCount: members.length,
      membersWithCalendar: withCalendar,
      aiSuggestion: suggestion,
      privacyNote: "メンバー全員が空いている時間帯のみ表示。各メンバーの予定の詳細は共有されません。",
    });
  } catch (err) {
    console.error("Group availability error:", err.message);
    res.status(500).json({ error: "空き時間の計算中にエラーが発生しました" });
  }
});

app.post("/api/groups/:groupId/messages", requireSession, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "メッセージが空です" });
  if (!isGroupMember(req.uid, req.params.groupId)) {
    return res.status(403).json({ error: "グループに参加してからメッセージできます" });
  }
  const msg = addGroupMessage(req.params.groupId, req.uid, text.trim());
  if (!msg) return res.status(404).json({ error: "グループが見つかりません" });
  res.json({ msg });
});

app.get("/api/groups/:groupId/messages", requireSession, (req, res) => {
  const msgs = getGroupMessages(req.params.groupId);
  if (msgs === null) return res.status(404).json({ error: "グループが見つかりません" });
  res.json({ messages: msgs });
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  if (genAI) {
    initDummyEmbeddings(generateEmbedding)
      .then(() => console.log("Dummy embeddings ready"))
      .catch((err) => console.error("Embedding init error:", err.message));
  }
});