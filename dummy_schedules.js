// dummy_schedules.js
// Weekly busy blocks for each dummy user, hand-written to match their bios
// in db.js. day: 0=Mon ... 6=Sun. These stand in for what a real
// freebusy.query() would return once Google Calendar OAuth is wired up.
//
// To use: in db.js, add `busyBlocks: DUMMY_SCHEDULES["1"]` (etc.) into each
// dummy user's profile, or merge in the loop (see the snippet in the server
// integration notes).

export const DUMMY_SCHEDULES = {
  // はな (1) — 浪人生, ストイック朝型, 毎朝6時〜夜11時勉強。予備校が日中。
  "1": [
    { day: 0, start: "09:00", end: "17:00" },
    { day: 1, start: "09:00", end: "17:00" },
    { day: 2, start: "09:00", end: "17:00" },
    { day: 3, start: "09:00", end: "17:00" },
    { day: 4, start: "09:00", end: "17:00" },
  ],
  // けんじ (2) — 浪人生, 夜型 23時〜2時集中。日中は自習室。
  "2": [
    { day: 0, start: "10:00", end: "18:00" },
    { day: 1, start: "10:00", end: "18:00" },
    { day: 2, start: "10:00", end: "18:00" },
    { day: 3, start: "10:00", end: "18:00" },
    { day: 4, start: "10:00", end: "18:00" },
  ],
  // さくら (3) — 社会人営業, 毎日残業, 朝の通勤30分のみ。
  "3": [
    { day: 0, start: "08:00", end: "20:00" },
    { day: 1, start: "08:00", end: "20:00" },
    { day: 2, start: "08:00", end: "20:00" },
    { day: 3, start: "08:00", end: "20:00" },
    { day: 4, start: "08:00", end: "20:00" },
  ],
  // たろう (4) — フリーランス, 週末は8時間以上勉強できる。平日は案件作業。
  "4": [
    { day: 0, start: "10:00", end: "19:00" },
    { day: 1, start: "10:00", end: "19:00" },
    { day: 2, start: "10:00", end: "19:00" },
    { day: 3, start: "10:00", end: "19:00" },
  ],
  // ゆき (5) — 大学生, 週1〜2回オンライン会話練習希望。授業は午前中心。
  "5": [
    { day: 0, start: "09:00", end: "13:00" },
    { day: 2, start: "09:00", end: "13:00" },
    { day: 4, start: "09:00", end: "15:00" },
  ],
  // りょう (6) — 銀行員, 朝4時半起き出勤前勉強, 日中は勤務。
  "6": [
    { day: 0, start: "08:30", end: "19:00" },
    { day: 1, start: "08:30", end: "19:00" },
    { day: 2, start: "08:30", end: "19:00" },
    { day: 3, start: "08:30", end: "19:00" },
    { day: 4, start: "08:30", end: "19:00" },
  ],
  // みか (7) — 大学生, TOEFL対策。研究と授業で日中忙しい。
  "7": [
    { day: 0, start: "09:00", end: "16:00" },
    { day: 1, start: "09:00", end: "16:00" },
    { day: 2, start: "09:00", end: "16:00" },
    { day: 3, start: "09:00", end: "16:00" },
    { day: 4, start: "13:00", end: "18:00" },
  ],
  // しょう (8) — 会社員ディレクター, 隙間時間活用。平日フル勤務。
  "8": [
    { day: 0, start: "09:30", end: "19:30" },
    { day: 1, start: "09:30", end: "19:30" },
    { day: 2, start: "09:30", end: "19:30" },
    { day: 3, start: "09:30", end: "19:30" },
    { day: 4, start: "09:30", end: "19:30" },
  ],
  // なな (9) — 高校生, 高3。学校 + 図書館自習。
  "9": [
    { day: 0, start: "08:00", end: "16:00" },
    { day: 1, start: "08:00", end: "16:00" },
    { day: 2, start: "08:00", end: "16:00" },
    { day: 3, start: "08:00", end: "16:00" },
    { day: 4, start: "08:00", end: "16:00" },
  ],
  // だいき (10) — 不動産会社員, 土日は内見対応あり。
  "10": [
    { day: 0, start: "09:00", end: "19:00" },
    { day: 1, start: "09:00", end: "19:00" },
    { day: 2, start: "09:00", end: "19:00" },
    { day: 3, start: "09:00", end: "19:00" },
    { day: 4, start: "09:00", end: "19:00" },
    { day: 5, start: "10:00", end: "15:00" },
  ],
  // えみ (11) — 外資系, 平日夜と休日に時間が取れる。
  "11": [
    { day: 0, start: "09:00", end: "18:00" },
    { day: 1, start: "09:00", end: "18:00" },
    { day: 2, start: "09:00", end: "18:00" },
    { day: 3, start: "09:00", end: "18:00" },
    { day: 4, start: "09:00", end: "18:00" },
  ],
  // じゅん (12) — 情報系大学生, 夜に勉強会したい。授業は午前〜午後。
  "12": [
    { day: 0, start: "10:00", end: "16:00" },
    { day: 1, start: "10:00", end: "16:00" },
    { day: 2, start: "10:00", end: "16:00" },
    { day: 3, start: "10:00", end: "16:00" },
  ],
};
