// In-memory user store. Replace with Postgres/Mongo for production.

const users = new Map(); // id -> user
const bySub = new Map(); // google_sub -> id
let nextId = 100; // start at 100; dummy users use ids 1-12

// ---------- helpers ----------------------------------------------------------

function emptyProfile() {
  return {
    nickname: null,
    gender: null,
    birthYear: null,
    affiliation: null,
    studyFields: [],
    currentLevel: null,
    goal: null,
    country: "日本",
    bio: null,
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
        u.profile.affiliation,
        (u.profile.studyFields || []).join(", "),
        u.profile.goal,
        u.profile.bio,
      ].filter(Boolean).join(" ");
      if (text) {
        const embedding = await embedFn(text);
        if (embedding) u.profile.embedding = embedding;
      }
    }
  }
}

// ---------- dummy users (P1) -------------------------------------------------

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
      gender: "female",
      birthYear: 2004,
      affiliation: "浪人生",
      studyFields: ["大学受験", "英語", "数学"],
      currentLevel: "共通テスト600点台。英語が得意で数学が苦手。",
      goal: "来年3月までに早稲田大学法学部に現役合格する",
      country: "日本",
      bio: "去年は緊張のあまり本番でパニックになって失敗してしまいました。今年は絶対リベンジしたいけど、周りに浪人してる友達がいなくて孤独を感じています。一緒に頑張れる仲間が欲しいです。毎朝6時に起きて夜11時まで勉強するストイックなタイプです。",
      profileComplete: true,
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
      gender: "male",
      birthYear: 2003,
      affiliation: "浪人生",
      studyFields: ["大学受験", "数学", "物理", "化学"],
      currentLevel: "数学は得意（模試偏差値68）。物理と化学を底上げ中。",
      goal: "東京大学理科一類に合格したい",
      country: "日本",
      bio: "東大を目指して2浪目です。1浪目は独りで抱え込んで精神的にしんどくなりました。今年は誰かと励ましあいながら進めたい。理系科目は得意だけど追い込み時期の焦りをコントロールするのが課題。夜型で23時〜深夜2時が最も集中できます。",
      profileComplete: true,
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
      gender: "female",
      birthYear: 1998,
      affiliation: "社会人（会社員）",
      studyFields: ["TOEIC", "英会話", "英語"],
      currentLevel: "TOEIC 595点。リスニングは650相当だがリーディングが570。",
      goal: "半年以内にTOEIC 800点を取って海外部門に異動したい",
      country: "日本",
      bio: "メーカーで営業をしています。英語が話せれば仕事の幅が広がると確信しているのに、毎日残業で勉強時間が確保できないのが悩みです。同じように忙しい中で英語を頑張っている人と繋がって、お互いに背中を押し合いたいです。朝の通勤電車30分が唯一の勉強タイム。",
      profileComplete: true,
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
      gender: "male",
      birthYear: 1995,
      affiliation: "社会人（フリーランス・経営者）",
      studyFields: ["プログラミング", "Python", "データ分析", "機械学習"],
      currentLevel: "HTML/CSSは習得済。PythonはAtCoderでbrown。",
      goal: "1年以内にデータサイエンティストとして転職する",
      country: "日本",
      bio: "Webデザイナーとして5年間働いてきたが、データの世界に魅力を感じて転身を決意しました。独学でやってきたけど、一人だと方向性が正しいか不安になることが多い。同じように転職を目指している人や、すでにエンジニアの人と繋がって刺激を受けたい。週末は8時間以上勉強できます。",
      profileComplete: true,
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
      gender: "female",
      birthYear: 2001,
      affiliation: "大学生・大学院生",
      studyFields: ["韓国語", "語学", "K-POP"],
      currentLevel: "ハングル検定4級。日常会話は少しできる。",
      goal: "1年後に韓国語能力試験（TOPIK）3級を取得する",
      country: "日本",
      bio: "韓国のドラマと音楽が好きで、字幕なしで楽しめるようになりたいと思い勉強を始めました。大学のサークルには韓国語仲間がいなくて、一人でやってるとモチベが続かないです。同じ目標を持つ人と週に1〜2回オンラインで会話練習できたら最高です。",
      profileComplete: true,
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
      gender: "male",
      birthYear: 1993,
      affiliation: "社会人（会社員）",
      studyFields: ["公認会計士", "簿記", "資格・検定"],
      currentLevel: "簿記2級取得済。公認会計士の短答式に向けて勉強中。",
      goal: "2年以内に公認会計士試験に合格する",
      country: "日本",
      bio: "銀行員として働きながら公認会計士を目指しています。合格率が低くて、やめようかと何度も思いましたが、ここまで来たら絶対にやり遂げたいです。朝4時半に起きて出勤前に勉強するのが習慣です。同じ難関資格に挑んでいる人と定期的に進捗を報告し合う関係が欲しいです。",
      profileComplete: true,
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
      gender: "female",
      birthYear: 2000,
      affiliation: "大学生・大学院生",
      studyFields: ["大学院受験", "英語", "TOEFL", "心理学"],
      currentLevel: "TOEFL 78点。心理学の専門知識はある程度あり。",
      goal: "来年9月にアメリカの大学院（心理学）に進学する",
      country: "日本",
      bio: "日本の大学で心理学を学んでいます。ずっと海外で研究がしたくて、来年アメリカの大学院を受験します。TOEFLのスピーキングがネックで、一人で練習するのに限界を感じています。英語も勉強も頑張っている人と繋がって、海外進学という共通の夢を語り合いたいです。",
      profileComplete: true,
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
      gender: "male",
      birthYear: 1990,
      affiliation: "社会人（会社員）",
      studyFields: ["プログラミング", "JavaScript", "React", "Web開発"],
      currentLevel: "JavaScriptは業務で使用。Reactは独学6ヶ月。",
      goal: "フリーランスのWebエンジニアとして独立する",
      country: "日本",
      bio: "IT系の会社でディレクターをしていますが、技術力をもっと身につけて自分でサービスを作れるようになりたいです。会社の仕事は忙しいので隙間時間を効率よく使うことを意識しています。同じくエンジニアリングを学んでいる人と、週1回でも進捗を共有できる関係が欲しいです。",
      profileComplete: true,
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
      gender: "female",
      birthYear: 2005,
      affiliation: "高校生",
      studyFields: ["大学受験", "英語", "国語", "日本史"],
      currentLevel: "文系。英語は得意（英検2級）。国語と日本史を強化中。",
      goal: "慶應義塾大学文学部に現役合格する",
      country: "日本",
      bio: "高3で受験勉強真っ最中です。文系科目が好きで、特に日本史は人よりも深く掘り下げて勉強しています。でも周りは理系志望が多くて、文系科目の話ができる人がいなくて少し寂しいです。一緒に志望校を目指す仲間が欲しいです。図書館での自習が好きです。",
      profileComplete: true,
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
      gender: "male",
      birthYear: 1997,
      affiliation: "社会人（会社員）",
      studyFields: ["宅建", "行政書士", "資格・検定", "法律"],
      currentLevel: "宅建取得済。行政書士は今年初挑戦。",
      goal: "行政書士の資格を取得して独立開業する",
      country: "日本",
      bio: "不動産会社に勤めています。宅建を取ってから法律の面白さに目覚め、さらに上を目指したくなりました。行政書士は範囲が広くて何から手をつければいいか迷っています。同じように法律系の資格を目指している人と情報交換しながら、お互いに高め合いたいです。",
      profileComplete: true,
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
      gender: "female",
      birthYear: 1988,
      affiliation: "社会人（会社員）",
      studyFields: ["英会話", "TOEIC", "英語", "ビジネス英語"],
      currentLevel: "TOEIC 720点。読み書きはできるが、話すのが苦手。",
      goal: "英語で自信を持って会議に参加できるようになる",
      country: "日本",
      bio: "外資系企業に転職して3年目です。社内の英語ミーティングで発言できずにいるのが悩みです。スピーキング力を上げるために英会話スクールにも通っていますが、一人での練習に限界を感じています。お互いに英語で話しかける練習相手を探しています。平日夜と休日に時間が取れます。",
      profileComplete: true,
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
      gender: "male",
      birthYear: 2002,
      affiliation: "大学生・大学院生",
      studyFields: ["プログラミング", "Python", "AI", "機械学習", "データ分析"],
      currentLevel: "Python基礎修了。scikit-learnで簡単なモデルを作れる段階。",
      goal: "AI・機械学習エンジニアとして就職する",
      country: "日本",
      bio: "情報系の大学に通っていますが、大学の授業だけでは実践的なスキルが身につかないと感じて独学を始めました。Kaggleのコンペに参加したいけど一人では心細いです。同じようにAIやデータサイエンスを学んでいる人と勉強会をしたり、お互いのコードをレビューし合える関係が理想です。",
      profileComplete: true,
    },
  },
];

// seed dummy users
for (const u of DUMMY_USERS) {
  users.set(u.id, u);
  bySub.set(u.google_sub, u.id);
}

// ---------- exports ----------------------------------------------------------

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
  u.profile.profileComplete = !!(u.profile.nickname && u.profile.bio && u.profile.goal);
  return { ...u };
}

export function getAllUsers() {
  return [...users.values()];
}

// ---------- connections ------------------------------------------------------

const connections = new Map(); // convKey -> { from, to, status }
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
  if (conn.to !== fromId) return null; // only the recipient can accept
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
        affiliation: partner?.profile?.affiliation || "",
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
        affiliation: sender?.profile?.affiliation || "",
        createdAt: c.createdAt,
      };
    });
}

// ---------- messages ---------------------------------------------------------

const messages = new Map(); // convKey -> [{ id, fromId, text, createdAt }]
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
