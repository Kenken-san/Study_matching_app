// In-memory user store. Replace with Postgres/Mongo for production.

const users = new Map(); // id -> user
const bySub = new Map(); // google_sub -> id
let nextId = 100;

// ---------- helpers ----------------------------------------------------------

function emptyProfile() {
  return {
    nickname: null,
    studyFields: [],
    goal: null,
    publicBio: null,
    privateReality: null,
    privateAffiliation: null,
    country: "日本",
    profileComplete: false,
    embedding: null,
  };
}

export function cosineSimilarity(vecA, vecB) {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function initDummyEmbeddings(embedFn) {
  for (const u of users.values()) {
    if (u.profile?.profileComplete && !u.profile.embedding) {
      const text = [
        u.profile.privateAffiliation,
        (u.profile.studyFields || []).join(", "),
        u.profile.goal,
        u.profile.publicBio,
        u.profile.privateReality,
      ].filter(Boolean).join(" ");
      if (text) {
        const embedding = await embedFn(text);
        if (embedding) u.profile.embedding = embedding;
      }
    }
  }
}

// ---------- dummy users ------------------------------------------------------

const DUMMY_USERS = [
  {
    id: "1",
    google_sub: "dummy_1",
    email: "hana@example.com",
    name: "Hana",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "はな",
      studyFields: ["大学受験", "英語", "数学"],
      goal: "来年3月までに早稲田大学法学部に合格する",
      publicBio: "早稲田大学法学部への合格を目指して、毎朝6時から夜11時まで全力で学んでいます。同じ目標に向かって支え合える仲間を探しています。",
      privateReality: "共通テスト600点台で英語は得意だが数学が苦手。去年は本番でパニックになり失敗した経験がある。浪人中で周りに同じ境遇の友達がおらず孤独を感じている。",
      privateAffiliation: "浪人生",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "2",
    google_sub: "dummy_2",
    email: "kenji@example.com",
    name: "Kenji",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "けんじ",
      studyFields: ["大学受験", "数学", "物理", "化学"],
      goal: "東京大学理科一類に合格する",
      publicBio: "東大合格という夢に向かって、理系科目を武器に突き進んでいます。誰かと励まし合いながらこの挑戦を乗り越えたいと思っています。",
      privateReality: "2浪目。数学は模試偏差値68と得意だが物理と化学を底上げ中。1浪目に精神的につらい時期があった。追い込み時期の焦りのコントロールが課題。夜型で23時〜深夜2時が集中できる。",
      privateAffiliation: "浪人生（2浪）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "3",
    google_sub: "dummy_3",
    email: "sakura@example.com",
    name: "Sakura",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "さくら",
      studyFields: ["TOEIC", "英会話", "英語"],
      goal: "半年以内にTOEIC 800点を取って海外部門に異動する",
      publicBio: "海外部門への異動という夢を叶えるために、忙しい日々の合間を縫ってTOEICに挑んでいます。同じように忙しくても英語を諦めない仲間と出会いたいです。",
      privateReality: "TOEIC 595点（リスニング650相当、リーディング570）。メーカー営業で毎日残業があり勉強時間の確保が難しい。朝の通勤電車30分が唯一の勉強タイム。",
      privateAffiliation: "社会人（会社員・メーカー営業）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "4",
    google_sub: "dummy_4",
    email: "taro@example.com",
    name: "Taro",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "たろう",
      studyFields: ["プログラミング", "Python", "データ分析", "機械学習"],
      goal: "1年以内にデータサイエンティストとして転職する",
      publicBio: "データサイエンティストへの転身という大きな挑戦に踏み出しました。週末は8時間以上学習に充てています。刺激し合えるエンジニア仲間と出会いたいです。",
      privateReality: "Webデザイナーとして5年のキャリア後、データ分析に転身を決意。HTML/CSS習得済みでPythonはAtCoder brown。独学で方向性が正しいか不安を感じることが多い。",
      privateAffiliation: "社会人（フリーランス・Webデザイナー）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "5",
    google_sub: "dummy_5",
    email: "yuki@example.com",
    name: "Yuki",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "ゆき",
      studyFields: ["韓国語", "語学", "K-POP"],
      goal: "1年後に韓国語能力試験（TOPIK）3級を取得する",
      publicBio: "韓国のドラマや音楽を字幕なしで楽しめることを夢見て、TOPIK 3級合格を目指しています。週に1〜2回一緒にオンライン会話練習できる仲間を探しています。",
      privateReality: "ハングル検定4級で日常会話が少しできる程度。大学のサークルに韓国語仲間がおらず、一人での勉強でモチベーションが続きにくい。",
      privateAffiliation: "大学生",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "6",
    google_sub: "dummy_6",
    email: "ryo@example.com",
    name: "Ryo",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "りょう",
      studyFields: ["公認会計士", "簿記", "資格・検定"],
      goal: "2年以内に公認会計士試験に合格する",
      publicBio: "公認会計士という夢に向かって、毎朝4時半に起きて学習する日々を続けています。同じ難関資格に挑む仲間と定期的に進捗を報告し合いたいです。",
      privateReality: "簿記2級取得済みで短答式に向けて勉強中。合格率の低さから何度も諦めかけた経験がある。銀行員として働きながら時間確保が課題。",
      privateAffiliation: "社会人（会社員・銀行員）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "7",
    google_sub: "dummy_7",
    email: "mika@example.com",
    name: "Mika",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "みか",
      studyFields: ["大学院受験", "英語", "TOEFL", "心理学"],
      goal: "来年9月にアメリカの大学院（心理学）に進学する",
      publicBio: "アメリカの大学院で心理学を研究するという夢を実現するため、TOEFLと専門知識を磨いています。海外進学という共通の夢を語り合える仲間を探しています。",
      privateReality: "TOEFL 78点でスピーキングがネック。一人での練習に限界を感じている。心理学の専門知識はある程度身についている。",
      privateAffiliation: "大学生（心理学専攻）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "8",
    google_sub: "dummy_8",
    email: "sho@example.com",
    name: "Sho",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "しょう",
      studyFields: ["プログラミング", "JavaScript", "React", "Web開発"],
      goal: "フリーランスのWebエンジニアとして独立する",
      publicBio: "自分でサービスを作れるエンジニアになるという夢に向かって、隙間時間を最大限活用して学習しています。週1回でも進捗を共有できる仲間を探しています。",
      privateReality: "ITディレクターとして勤務中。JavaScriptは業務使用だがReactは独学6ヶ月。会社が忙しく学習時間の確保が難しい。",
      privateAffiliation: "社会人（会社員・ITディレクター）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "9",
    google_sub: "dummy_9",
    email: "nana@example.com",
    name: "Nana",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "なな",
      studyFields: ["大学受験", "英語", "国語", "日本史"],
      goal: "慶應義塾大学文学部に現役合格する",
      publicBio: "慶應義塾大学文学部への現役合格を目指して、文系科目を深く掘り下げて学んでいます。一緒に志望校を目指せる仲間と出会いたいです。",
      privateReality: "英語は英検2級で得意だが国語と日本史を強化中。周りは理系志望が多く文系の話ができる人がおらず孤独を感じている。",
      privateAffiliation: "高校生（高3）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "10",
    google_sub: "dummy_10",
    email: "daiki@example.com",
    name: "Daiki",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "だいき",
      studyFields: ["宅建", "行政書士", "資格・検定", "法律"],
      goal: "行政書士の資格を取得して独立開業する",
      publicBio: "行政書士として独立開業するという目標に向かって、法律の世界を深く探求しています。同じく法律系の資格を目指す仲間と情報交換しながら高め合いたいです。",
      privateReality: "宅建取得済みだが行政書士は今年初挑戦。範囲が広く何から手をつければいいか迷っている。",
      privateAffiliation: "社会人（会社員・不動産業）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "11",
    google_sub: "dummy_11",
    email: "emi@example.com",
    name: "Emi",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "えみ",
      studyFields: ["英会話", "TOEIC", "英語", "ビジネス英語"],
      goal: "英語で自信を持って会議に参加できるようになる",
      publicBio: "英語で自信を持って国際的に活躍できる人材を目指しています。平日夜や休日に一緒に英語で話す練習ができる仲間を探しています。",
      privateReality: "TOEIC 720点だがスピーキングが苦手。外資系勤務3年目だが英語ミーティングで発言できずにいる。英会話スクールにも通っているが一人練習に限界を感じている。",
      privateAffiliation: "社会人（会社員・外資系）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
  {
    id: "12",
    google_sub: "dummy_12",
    email: "jun@example.com",
    name: "Jun",
    picture: null,
    createdAt: Date.now(),
    profile: {
      nickname: "じゅん",
      studyFields: ["プログラミング", "Python", "AI", "機械学習", "データ分析"],
      goal: "AI・機械学習エンジニアとして就職する",
      publicBio: "AIエンジニアとして社会に貢献するというビジョンを持って独学を続けています。Kaggleのコンペや勉強会を一緒に楽しめる仲間を探しています。",
      privateReality: "Python基礎修了でscikit-learnで簡単なモデルが作れる段階。大学の授業だけでは実践的スキルが身につかないと感じている。Kaggle参加に一人では心細い。",
      privateAffiliation: "大学生（情報系）",
      country: "日本",
      profileComplete: true,
      embedding: null,
    },
  },
];

for (const u of DUMMY_USERS) {
  users.set(u.id, u);
  bySub.set(u.google_sub, u.id);
}

// ---------- user exports ------------------------------------------------------

export async function upsertUser({ google_sub, email, name, picture }) {
  const existingId = bySub.get(google_sub);
  if (existingId) {
    const u = users.get(existingId);
    Object.assign(u, { email, name, picture });
    return { ...u, isNew: false };
  }
  const id = String(nextId++);
  const user = {
    id,
    google_sub,
    email,
    name,
    picture,
    createdAt: Date.now(),
    profile: emptyProfile(),
  };
  users.set(id, user);
  bySub.set(google_sub, id);
  return { ...user, isNew: true };
}

export async function getUser(id) {
  return users.get(id) || null;
}

export async function updateProfile(id, fields) {
  const u = users.get(id);
  if (!u) return null;
  if (!u.profile) u.profile = emptyProfile();
  Object.assign(u.profile, fields);
  u.profile.profileComplete = !!(
    u.profile.nickname && u.profile.goal && u.profile.publicBio
  );
  return { ...u };
}

export function getAllUsers() {
  return [...users.values()];
}

// ---------- connections -------------------------------------------------------

const connections = new Map();
let nextConnId = 1;

function convKey(a, b) {
  return [a, b].sort().join("_");
}

function isDummy(id) {
  return Number(id) >= 1 && Number(id) <= 12;
}

export function sendConnect(fromId, toId) {
  const key = convKey(fromId, toId);
  if (connections.has(key)) return connections.get(key);
  const status = isDummy(toId) ? "accepted" : "pending";
  const conn = { id: String(nextConnId++), from: fromId, to: toId, status, createdAt: Date.now() };
  connections.set(key, conn);
  return conn;
}

export function acceptConnect(fromId, toId) {
  const key = convKey(fromId, toId);
  const conn = connections.get(key);
  if (!conn) return null;
  if (conn.to !== fromId) return null;
  conn.status = "accepted";
  return conn;
}

export function getConnectionStatus(uid, otherId) {
  const conn = connections.get(convKey(uid, otherId));
  if (!conn) return "none";
  if (conn.status === "accepted") return "accepted";
  if (conn.from === uid) return "pending_sent";
  return "pending_received";
}

export function getConnections(uid) {
  return [...connections.values()]
    .filter((c) => c.status === "accepted" && (c.from === uid || c.to === uid))
    .map((c) => {
      const partnerId = c.from === uid ? c.to : c.from;
      const partner = users.get(partnerId);
      return {
        connId: c.id,
        partnerId,
        nickname: partner?.profile?.nickname || partner?.name || "?",
        studyFields: partner?.profile?.studyFields || [],
        goal: partner?.profile?.goal || "",
        createdAt: c.createdAt,
      };
    });
}

export function getPending(uid) {
  return [...connections.values()]
    .filter((c) => c.status === "pending" && c.to === uid)
    .map((c) => {
      const sender = users.get(c.from);
      return {
        connId: c.id,
        fromId: c.from,
        nickname: sender?.profile?.nickname || sender?.name || "?",
        studyFields: sender?.profile?.studyFields || [],
        createdAt: c.createdAt,
      };
    });
}

// ---------- messages ----------------------------------------------------------

const messages = new Map();
let nextMsgId = 1;

export function addMessage(fromId, toId, text) {
  const key = convKey(fromId, toId);
  if (!messages.has(key)) messages.set(key, []);
  const msg = { id: String(nextMsgId++), fromId, text, createdAt: Date.now() };
  messages.get(key).push(msg);
  return msg;
}

export function getMessages(uid1, uid2) {
  return messages.get(convKey(uid1, uid2)) || [];
}

// ---------- groups ------------------------------------------------------------

const groups = new Map();
let nextGroupId = 1;
const groupMessages = new Map();
let nextGroupMsgId = 1;

// A group now carries `pending`: a Set of userIds who requested to join but
// haven't been approved yet. Only the creator can approve/reject them.
function serializeGroup(g, viewerId) {
  return {
    id: g.id,
    creatorId: g.creatorId,
    name: g.name,
    description: g.description,
    tags: g.tags,
    members: [...g.members],
    memberCount: g.members.size,
    pendingCount: g.pending.size,
    // viewer-specific flags so the UI can render the right button/state
    isCreator: viewerId != null && g.creatorId === viewerId,
    isMember: viewerId != null && g.members.has(viewerId),
    isPending: viewerId != null && g.pending.has(viewerId),
    // creators get to see the actual pending requesters (with names)
    pendingRequests:
      viewerId != null && g.creatorId === viewerId
        ? [...g.pending].map((uid) => {
            const u = users.get(uid);
            return {
              userId: uid,
              nickname: u?.profile?.nickname || u?.name || "?",
              studyFields: u?.profile?.studyFields || [],
              goal: u?.profile?.goal || "",
            };
          })
        : undefined,
  };
}

export function createGroup(creatorId, name, description, tags) {
  const id = String(nextGroupId++);
  const group = {
    id,
    creatorId,
    name,
    description: description || "",
    tags: tags || [],
    members: new Set([creatorId]),
    pending: new Set(),
    createdAt: Date.now(),
  };
  groups.set(id, group);
  groupMessages.set(id, []);
  return serializeGroup(group, creatorId);
}

// A non-member requests to join. They are NOT added immediately — they go into
// the pending set until the creator approves. Returns { group, status }.
export function requestJoinGroup(userId, groupId) {
  const g = groups.get(groupId);
  if (!g) return null;
  if (g.members.has(userId)) return { group: serializeGroup(g, userId), status: "already_member" };
  g.pending.add(userId);
  return { group: serializeGroup(g, userId), status: "pending" };
}

// Creator approves a pending requester -> moves them into members.
export function approveJoinRequest(creatorId, groupId, requesterId) {
  const g = groups.get(groupId);
  if (!g) return null;
  if (g.creatorId !== creatorId) return { error: "not_creator" };
  if (!g.pending.has(requesterId)) return { error: "no_such_request" };
  g.pending.delete(requesterId);
  g.members.add(requesterId);
  return { group: serializeGroup(g, creatorId) };
}

// Creator rejects a pending requester -> removes them from pending.
export function rejectJoinRequest(creatorId, groupId, requesterId) {
  const g = groups.get(groupId);
  if (!g) return null;
  if (g.creatorId !== creatorId) return { error: "not_creator" };
  g.pending.delete(requesterId);
  return { group: serializeGroup(g, creatorId) };
}

export function isGroupMember(userId, groupId) {
  return groups.get(groupId)?.members.has(userId) ?? false;
}

export function getGroups(viewerId) {
  return [...groups.values()].map((g) => serializeGroup(g, viewerId));
}

// Raw group objects (Sets intact) — for server-side logic like Gemini suggest.
export function getGroupsRaw() {
  return [...groups.values()];
}

// ---------- seeded dummy groups ----------------------------------------------
// Created by dummy users so the app has content on first load. Members are
// existing dummy user IDs (see DUMMY_USERS above, ids "1".."12").

const DUMMY_GROUPS = [
  {
    creatorId: "2", name: "難関大学を目指す浪人生の会",
    description: "東大・早慶など難関大を目指す浪人生の進捗共有グループ。朝活報告と模試の振り返りを中心に、孤独になりがちな浪人生活を一緒に乗り越えましょう。",
    tags: ["大学受験", "浪人", "難関大"], members: ["2", "1"],
  },
  {
    creatorId: "3", name: "働きながらTOEIC・英語",
    description: "残業や育児の合間に英語を続ける社会人グループ。スキマ時間の使い方やTOEIC・英会話の教材情報を交換しています。忙しくても諦めない仲間募集中。",
    tags: ["TOEIC", "英語", "社会人", "英会話"], members: ["3", "11"],
  },
  {
    creatorId: "4", name: "未経験からのデータ分析・ML",
    description: "他業種からデータサイエンス・機械学習に転身を目指す人の集まり。Kaggleや学習ロードマップの相談、独学の不安を共有しています。",
    tags: ["データ分析", "機械学習", "Python", "転職", "AI"], members: ["4", "12"],
  },
  {
    creatorId: "6", name: "難関資格に挑む社会人",
    description: "会計士・行政書士など難関資格を働きながら目指す人のグループ。早朝学習の進捗報告と、心が折れそうな時の励まし合いの場です。",
    tags: ["公認会計士", "行政書士", "簿記", "資格・検定", "社会人"], members: ["6", "10"],
  },
  {
    creatorId: "7", name: "海外大学院・留学準備",
    description: "海外大学院進学やTOEFLに挑む人のグループ。スピーキング練習の相手探しや出願準備の情報交換をしています。海外という共通の夢を語り合いましょう。",
    tags: ["大学院受験", "TOEFL", "留学", "英語"], members: ["7"],
  },
];

for (const dg of DUMMY_GROUPS) {
  const id = String(nextGroupId++);
  const group = {
    id,
    creatorId: dg.creatorId,
    name: dg.name,
    description: dg.description,
    tags: dg.tags,
    members: new Set(dg.members),
    pending: new Set(),
    createdAt: Date.now(),
  };
  groups.set(id, group);
  groupMessages.set(id, []);
}

export function addGroupMessage(groupId, fromId, text) {
  const msgs = groupMessages.get(groupId);
  if (msgs === undefined) return null;
  const msg = { id: String(nextGroupMsgId++), fromId, text, createdAt: Date.now() };
  msgs.push(msg);
  return msg;
}

export function getGroupMessages(groupId) {
  const msgs = groupMessages.get(groupId);
  return msgs === undefined ? null : msgs;
}