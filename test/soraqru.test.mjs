// そらくる（SoraQru）のテスト：気圧の段階・Open-Meteo の返事の読みこみ・端末の中身・カードの組み立て
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

import * as M from "../js/meteo.js";
import * as S from "../js/store.js";
import * as C from "../js/card.js";

const require = createRequire(import.meta.url);
const OQRN = path.join(os.homedir(), "GitHub/q-oqrn");
const { checkMessages } = require(path.join(OQRN, "tools/qtest/fake-gas.js"));
const XSS = "<img src=x onerror=alert(1)>"; // qcheck-ok: W8 テストの見本の文字（画面では動かさない）

// 日本（UTC+9）の 2026-10-23 10:30
const NOW = new Date("2026-10-23T01:30:00Z");

// Open-Meteo の返事の見本：前の日から3日ぶん（96 時間）。pressure は時間 → hPa
function sample({ pressure = () => 1013, offset = 32400 } = {}) {
  const time = [];
  const p = [];
  for (let i = 0; i < 96; i++) {
    const d = new Date(Date.UTC(2026, 9, 22, i));
    time.push(d.toISOString().slice(0, 16));
    p.push(pressure(i - 24)); // 今日の0時が 0
  }
  return {
    utc_offset_seconds: offset,
    hourly: {
      time,
      pressure_msl: p,
      temperature_2m: time.map((_, i) => 15 + (i % 24) / 3),
      weather_code: time.map((_, i) => (i % 24 < 12 ? 1 : 61)),
      precipitation_probability: time.map(() => 20),
      is_day: time.map((_, i) => (i % 24 >= 6 && i % 24 < 18 ? 1 : 0))
    },
    daily: {
      time: ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"],
      weather_code: [1, 61, 3, 0],
      temperature_2m_max: [20, 22.4, 19, 18],
      temperature_2m_min: [10, 13.6, 12, 9],
      precipitation_probability_max: [0, 60, 30, 10]
    }
  };
}

// ---- 気圧の段階 ----
test("段階：3時間で 1 未満＝通常・2 未満＝やや注意・3 未満＝注意・それ以上＝警戒（上がっても下がっても）", () => {
  const cases = [[0, 0], [0.9, 0], [-0.99, 0], [1, 1], [-1.9, 1], [2, 2], [2.9, 2], [-3, 3], [8, 3]];
  for (const [change, level] of cases) assert.equal(M.levelOf(change), level, String(change));
  for (const bad of [null, undefined, "", NaN, "x", Infinity]) assert.equal(M.levelOf(bad), null, String(bad));
  assert.deepEqual(M.LEVELS.map((l) => l.label), ["通常", "やや注意", "注意", "警戒"]);
  assert.deepEqual(M.LEVELS.map((l) => l.color), ["#7FA7D9", "#E8B931", "#F08A24", "#E5534B"]);
});

test("段階は3時間前とくらべる（0時は前の日の21時と）", () => {
  // 今日の 0 時から 1 時間に 0.8 hPa ずつ下がる → 3時間で 2.4（注意）
  const data = M.parseForecast(sample({ pressure: (h) => (h < 0 ? 1015 : 1015 - 0.8 * (h + 1)) }), NOW);
  const today = M.dayRows(data, 0, NOW);
  assert.equal(today.length, 24);
  assert.equal(today[0].hour, 0);
  assert.equal(today[0].change, -0.8); // 前の日の21時（1015）とくらべる
  assert.equal(today[0].level, 0);
  assert.equal(today[1].level, 1);
  assert.equal(today[5].change, -2.4);
  assert.equal(today[5].level, 2);
});

test("注意の時間帯をまとめる：つづく時間は1つ、いちばん強い段階と向き", () => {
  const rows = [0, 0, 1, 2, 3, 0, 1].map((level, hour) => ({ hour, level, change: level ? -level : 0 }));
  const ranges = M.alertRanges(rows);
  assert.deepEqual(ranges, [
    { from: 2, to: 5, level: 3, dir: "down" },
    { from: 6, to: 7, level: 1, dir: "down" }
  ]);
  assert.equal(M.rangeText(ranges[0]), "2〜5時 警戒（下がる）");
  assert.equal(M.daySummary(rows), "2〜5時 警戒（下がる）、6〜7時 やや注意（下がる）");
  assert.equal(M.daySummary(rows.map((r) => ({ ...r, level: 0 }))), "1日を通して 通常");
  assert.equal(M.daySummary(rows.map((r) => ({ ...r, level: null }))), "");
});

// ---- Open-Meteo の返事 ----
test("返事を読む：今日の0時から、その地点の時刻で", () => {
  const data = M.parseForecast(sample(), NOW);
  assert.equal(data.offset, 32400);
  assert.equal(data.hours[0].t, "2026-10-23T00:00");
  assert.equal(data.hours.length, 72);
  assert.equal(M.localHour(NOW, data.offset), 10);
  const info = M.dayInfo(data, 0, NOW);
  assert.deepEqual(info, { date: "2026-10-23", code: 61, max: 22.4, min: 13.6, pop: 60 });
  assert.equal(M.dayRows(data, 1, NOW)[0].t, "2026-10-24T00:00");
  assert.equal(M.dayLabel("2026-10-23"), "10/23（金）");
});

test("壊れた・欠けた返事は null（落ちない）", () => {
  const bads = [null, undefined, 1, "x", [], {}, { hourly: null }, { hourly: { time: "x", pressure_msl: [] } }, { hourly: { time: [], pressure_msl: [] } }, { hourly: { time: ["2026-10-23T00:00"] } }];
  for (const bad of bads) assert.equal(M.parseForecast(bad, NOW), null, JSON.stringify(bad));
  // 気圧がすべて null
  assert.equal(M.parseForecast(sample({ pressure: () => null }), NOW), null);
  // ずれがありえない
  assert.equal(M.parseForecast(sample({ offset: 999999 }), NOW), null);
});

test("ところどころ欠けた返事：読めるところだけ。daily がなければ1時間ごとから作る", () => {
  const json = sample();
  json.hourly.pressure_msl[24 + 5] = null; // 今日の5時
  json.hourly.temperature_2m = "x";
  json.hourly.time[24 + 7] = "こわれた時刻";
  delete json.daily;
  const data = M.parseForecast(json, NOW);
  const today = M.dayRows(data, 0, NOW);
  assert.equal(today.length, 23); // 7時が抜ける
  const five = today.find((r) => r.hour === 5);
  assert.equal(five.hpa, null);
  assert.equal(five.level, null);
  assert.equal(today.find((r) => r.hour === 8).level, null); // 3時間前（5時）の気圧がない
  assert.equal(today.find((r) => r.hour === 10).level, null); // 3時間前（7時）の時刻が読めない
  assert.equal(today.find((r) => r.hour === 9).level, 0);
  assert.equal(five.temp, null);
  const info = M.dayInfo(data, 0, NOW);
  assert.equal(info.max, null);
  assert.equal(info.pop, 20);
  assert.equal(info.code, 61);
});

test("地名さがし：日本を先・人の多い順・同じ場所は1つ・壊れた結果は捨てる", () => {
  const a = { results: [{ name: "名古屋", latitude: 35.18, longitude: 136.91, country_code: "JP", admin1: "愛知県", population: 2e6 }, { name: "Nagoya", latitude: 0, longitude: 999 }, null, { name: XSS, latitude: 1, longitude: 2, country: "X", population: 9e9 }] };
  const b = { results: [{ name: "名古屋市", latitude: 35.181, longitude: 136.906, country_code: "JP" }, { latitude: 1 }] };
  const list = M.parseGeocode(a, b, null, { results: "x" });
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "名古屋");
  assert.equal(list[0].sub, "愛知県");
  assert.equal(list[1].name, XSS); // 文字は文字のまま（画面では esc する）
  assert.deepEqual(M.geocodeUrls("名古屋").length, 2);
  assert.deepEqual(M.geocodeUrls("名古屋市").length, 1);
  assert.deepEqual(M.geocodeUrls("  "), []);
  assert.ok(M.geocodeUrls("名古屋")[0].startsWith("https://geocoding-api.open-meteo.com/v1/search?"));
});

test("聞く URL：Open-Meteo だけ・場所は 0.01 度に丸める", () => {
  const url = new URL(M.forecastUrl(35.171234, 136.881987));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "35.17");
  assert.equal(url.searchParams.get("longitude"), "136.88");
  assert.equal(url.searchParams.get("past_days"), "1");
  assert.equal(M.validLatLon(91, 0), null);
  assert.equal(M.validLatLon("x", 0), null);
});

test("天気の番号 → 絵と言葉", () => {
  assert.equal(M.weatherOf(0).emoji, "☀️");
  assert.equal(M.weatherOf(0, 0).emoji, "🌙");
  assert.equal(M.weatherOf(63).label, "雨");
  assert.equal(M.weatherOf(95).label, "雷雨");
  assert.equal(M.weatherOf(null).label, "—");
});

// ---- 端末の中身 ----
const mem = (raw) => {
  const m = new Map(raw === undefined ? [] : [[S.KEY, raw]]);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("端末の中身：壊れていても止まらず、空から", () => {
  for (const raw of [undefined, "{", "null", "5", '"x"', "[]", '{"places":"x","cache":[1]}']) {
    assert.deepEqual(S.load(mem(raw)), S.blank(), String(raw));
  }
  const throwing = { getItem() { throw new Error("blocked"); } };
  assert.deepEqual(S.load(throwing), S.blank());
  assert.equal(S.save(S.blank(), { setItem() { throw new Error("full"); } }), false);
});

test("端末の中身：形のちがう地点は捨て、名前は長さに上限、見ている地点がなければ現在地", () => {
  const raw = JSON.stringify({
    places: [
      { id: "a1", name: "実家", emoji: "🏠", lat: 35.1712, lon: 136.88, src: "gps" },
      { id: "a1", name: "同じ id", lat: 1, lon: 1 },
      { id: "../x", name: "へんな id", lat: 1, lon: 1 },
      { id: "b2", name: XSS + "あいうえお", emoji: "💣", lat: 1, lon: 2 },
      { id: "c3", name: "", lat: 1, lon: 1 },
      { id: "d4", name: "範囲の外", lat: 100, lon: 1 },
      null
    ],
    current: "zz",
    here: { lat: "35.123", lon: 136.9 }
  });
  const s = S.load(mem(raw));
  assert.deepEqual(s.places.map((p) => p.id), ["a1", "b2"]);
  assert.deepEqual(s.places[0], { id: "a1", name: "実家", emoji: "🏠", lat: 35.17, lon: 136.88, src: "gps" });
  assert.equal([...s.places[1].name].length, S.MAX_NAME);
  assert.equal(s.places[1].emoji, "📍");
  assert.equal(s.places[1].src, "search");
  assert.equal(s.current, "here");
  assert.deepEqual(s.here, { lat: 35.12, lon: 136.9 });
});

test("端末の中身：覚えた天気は1時間は新しい。古すぎる・先の時刻・形のちがうものは捨てる", () => {
  const data = M.parseForecast(sample(), NOW);
  const now = NOW.getTime();
  const s = S.blank();
  S.putCache(s, 35.17, 136.88, data, now - 10 * 60 * 1000);
  const back = S.parse(JSON.stringify({ ...s, cache: { ...s.cache, "1.00,2.00": { at: now - 5 * 24 * 3600e3, data }, "3.00,4.00": { at: now + 3600e3, data }, "5.00,6.00": { at: now, data: { hours: "x" } }, bad: { at: now, data } } }), now);
  assert.deepEqual(Object.keys(back.cache), ["35.17,136.88"]);
  assert.equal(S.cached(back, 35.17, 136.88, now).fresh, true);
  assert.equal(S.cached(back, 35.17, 136.88, now + 60 * 60 * 1000).fresh, false);
  assert.equal(S.cached(back, 1, 1, now), null);
  // 読みなおしても、画面で使う形はそのまま
  assert.deepEqual(back.cache["35.17,136.88"].data, data);
});

test("覚えた天気は新しいものから 10 か所まで", () => {
  const data = M.parseForecast(sample(), NOW);
  const s = S.blank();
  for (let i = 0; i < 14; i++) S.putCache(s, i, i, data, NOW.getTime() + i);
  assert.equal(Object.keys(s.cache).length, S.MAX_CACHE);
  assert.ok(!s.cache["0.00,0.00"]);
  assert.ok(s.cache["13.00,13.00"]);
});

test("地点：足す・同じ場所は1つ・上限・消して元に戻す", () => {
  const s = S.blank();
  const a = S.addPlace(s, { name: "実家", emoji: "🏠", lat: 35.171, lon: 136.88, src: "gps" });
  assert.equal(S.addPlace(s, { name: "また", lat: 35.17, lon: 136.88 }), a);
  for (let i = 1; i < S.MAX_PLACES; i++) assert.ok(S.addPlace(s, { name: `p${i}`, lat: i, lon: i }));
  assert.equal(S.addPlace(s, { name: "多すぎ", lat: 50, lon: 50 }), null);
  s.current = a.id;
  const undo = S.removePlace(s, a.id);
  assert.equal(s.current, "here");
  assert.equal(s.places.length, S.MAX_PLACES - 1);
  S.restorePlace(s, undo);
  assert.equal(s.places[0].id, a.id);
  assert.equal(S.addPlace(s, { name: "x", lat: "x", lon: 1 }), null);
});

// ---- カード（おくるんのお知らせカード） ----
// おくるんのカードの組み立て（q-oqrn/card/js）をそのまま動かして、LINE が受けつける形かを確かめる
function oqrnFlex(cardUrl) {
  const dir = path.join(OQRN, "card/js");
  const ui = fs.readFileSync(path.join(OQRN, "shared/ui.js"), "utf8");
  const PALETTE = vm.runInNewContext(/const PALETTE = (\[[\s\S]*?\n  \]);/.exec(ui)[1]);
  const store = new Map();
  const ls = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const u = new URL(cardUrl);
  const ctx = vm.createContext({
    window: { LINE_SHARE_CONFIG: { liffId: u.pathname.split("/")[1] }, LineShareUI: { PALETTE } },
    location: new URL(`https://katsuan.github.io/line-share/card/${u.search}`),
    localStorage: ls,
    sessionStorage: ls,
    history: { replaceState() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    console, structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa
  });
  for (const file of ["core.js", "storage.js", "state.js", "url.js", "deck.js", "render.js", "kinds.js", "soccer.js", "flex.js", "templates.js"]) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8"), ctx, { filename: file });
  }
  return JSON.parse(JSON.stringify(vm.runInContext("state = hydrate(getQueryState(new URLSearchParams(location.search))); buildFlexMessage()", ctx)));
}

function cardUrl(params) {
  const sandbox = { window: {}, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(OQRN, "shared/oqrn.js"), "utf8"), sandbox);
  return sandbox.window.OQRN.cardUrl(params);
}

test("カード：今日・明日の注意の時間帯と天気、出典、流入口", () => {
  // 今日の 15〜17 時に大きく下がる
  const data = M.parseForecast(sample({ pressure: (h) => (h >= 15 && h <= 17 ? 1013 - (h - 14) * 1.2 : h > 17 ? 1009.4 : 1013) }), NOW);
  const p = C.cardParams({ name: "名古屋", lat: 35.18, lon: 136.91, src: "search" }, data, NOW);
  assert.equal(p.get("from"), "soraqru");
  assert.equal(p.get("title"), "名古屋の今日・明日");
  assert.equal(p.get("date"), "10/23（金）・10/24（土）");
  const detail = p.get("detail");
  // 見出し・天気・気圧の時間帯は、それぞれ1行に
  assert.match(detail, /^【今日 10\/23（金）】\n🌧️ 雨 22°\/14° ☔60%\n🌀 気圧（10時から）\n・15〜20時 警戒（下がる）\n\n/);
  // 夜に送ると、今日はこれからの時間だけ
  const night = C.cardParams(null, M.parseForecast(sample(), NOW), new Date("2026-10-23T13:30:00Z")).get("detail");
  assert.match(night, /🌀 気圧（22時から）：通常/);
  assert.match(detail, /【明日 10\/24（土）】\n☁️ くもり 19°\/12° ☔30%\n🌀 気圧：1日を通して 通常/);
  // 時間帯がいくつもある日は、1つずつの行に（4つ目からは「ほか」）
  const many = C.cardParams(null, M.parseForecast(sample({ pressure: (h) => 1013 + (Math.floor(h / 3) % 2 ? 0 : (h % 3) * 1.5) }), NOW), new Date("2026-10-22T15:30:00Z")).get("detail");
  assert.match(many, /🌀 気圧\n・\d+〜\d+時 [^\n]+\n・\d+〜\d+時 [^\n]+\n・\d+〜\d+時 [^\n]+\n・ほか\d+か所/);
  assert.match(detail, /天気データ：Open-Meteo\.com（CC BY 4\.0）/);
  assert.ok([...detail].length <= 300);
  assert.doesNotMatch(detail, /頭痛/);
  assert.equal(p.get("actionUrl"), "https://katsuan.github.io/soraqru/?at=35.18%2C136.91&name=%E5%90%8D%E5%8F%A4%E5%B1%8B");
});

test("カード：現在地・いまの場所から足した地点は、場所をリンクに入れない", () => {
  const data = M.parseForecast(sample(), NOW);
  assert.equal(C.cardParams(null, data, NOW).get("actionUrl"), C.PAGE_URL);
  assert.equal(C.cardParams({ name: "実家", lat: 35.18, lon: 136.91, src: "gps" }, data, NOW).get("actionUrl"), C.PAGE_URL);
  assert.equal(C.cardParams(null, data, NOW).get("title"), "現在地の今日・明日");
});

test("カード：おくるんで組み立てた Flex を LINE が受けつける（長い名前・荒れた日・外からの文字でも）", () => {
  const wild = M.parseForecast(sample({ pressure: (h) => 1013 + (h % 2 ? 4 : -4) }), NOW); // 1時間おきに大きく上下
  const cases = [
    [{ name: "名古屋", lat: 35.18, lon: 136.91, src: "search" }, M.parseForecast(sample(), NOW)],
    [{ name: XSS, lat: 35.18, lon: 136.91, src: "search" }, wild],
    [null, wild]
  ];
  for (const [place, data] of cases) {
    const params = C.cardParams(place, data, NOW);
    const url = cardUrl(params);
    assert.ok(url.startsWith("https://liff.line.me/"));
    assert.doesNotMatch(url, /\+/); // 空白は %20
    const flex = oqrnFlex(url);
    const errors = checkMessages([flex]).filter((x) => x.level === "error");
    assert.deepEqual(errors, [], JSON.stringify(errors));
    const texts = JSON.stringify(flex);
    assert.match(texts, /Open-Meteo/);
    // ボタンは、そらくるを開くリンク（あとで押されても困らない）
    const buttons = flex.contents.footer.contents.filter((x) => x.type === "button");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].action.type, "uri");
    assert.ok(buttons[0].action.uri.startsWith(C.PAGE_URL));
  }
});
