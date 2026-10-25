// 天気の知らせボット（gas/）のテスト：本物の LINE・シート・Open-Meteo には触らない（q-oqrn/tools/qtest/fake-gas.js）
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as M from "../js/meteo.js";

const require = createRequire(import.meta.url);
const { createGas, checkMessages, response } = require(path.join(os.homedir(), "GitHub/q-oqrn/tools/qtest/fake-gas.js"));
const GAS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../gas");

const KEY = "k".repeat(32);
const OWNER = "U" + "a".repeat(32);
const FRIEND = "U" + "b".repeat(32);
const STRANGER = "U" + "c".repeat(32);
const GROUP = "C" + "d".repeat(32);

// 日本の今日・明日（テストを動かした日）
const jstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

// Open-Meteo の返事の見本：前の日から3日ぶん。pressure(dayIndex, hour) で気圧、pop(dayIndex, hour) で降水確率
function forecastJson({ pressure = () => 1013, pop = () => 10, max = [18, 18, 18] } = {}) {
  const days = [jstDay(-1), jstDay(0), jstDay(1)];
  const time = [];
  const p = [];
  const r = [];
  days.forEach((date, di) => {
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      p.push(pressure(di, h));
      r.push(pop(di, h));
    }
  });
  return { utc_offset_seconds: 32400, hourly: { time, pressure_msl: p, precipitation_probability: r, temperature_2m: time.map(() => 18) }, daily: { time: days, temperature_2m_max: max } };
}

function makeBot({ properties = {}, forecast = forecastJson(), meteo, members = [], quota } = {}) {
  const gas = createGas({
    dir: GAS_DIR,
    properties: { LINE_CHANNEL_ACCESS_TOKEN: "test-token", WEBHOOK_KEY: KEY, OWNER_USER_ID: OWNER, ...properties },
    fetch(url) {
      if (url.startsWith("https://api.open-meteo.com/")) return meteo ? meteo(url) : response(200, forecast);
      if (url.startsWith("https://mreversegeocoder.gsi.go.jp/")) return response(200, { results: { muniCd: "23105", lv01Nm: "名駅" } });
      if (url.startsWith("https://katsuan.github.io/soraqru/data/muni.json")) return response(200, { 23105: "名古屋市中村区" });
      if (/\/message\/quota\/consumption$/.test(url)) return response(200, { totalUsage: quota ? quota.used : 0 });
      if (/\/message\/quota$/.test(url)) return response(200, quota ? { type: "limited", value: quota.value } : { type: "none" });
      if (/\/v2\/bot\/profile\//.test(url)) return response(200, { displayName: url.includes(FRIEND) ? "ともだち" : "持ち主" });
      return undefined;
    }
  });
  if (members.length) gas.seed("使う人", [["userId", "displayName", "status", "createdAt", "updatedAt"], ...members]);
  return gas;
}

const userSource = (userId) => ({ type: "user", userId });
const groupSource = (userId) => ({ type: "group", groupId: GROUP, userId });
let tokenSeq = 0;
const say = (gas, source, text) => gas.lineEvent({ type: "message", replyToken: `r${++tokenSeq}`, source, message: { type: "text", id: "m", text } }, { key: KEY });
const press = (gas, source, data) => gas.lineEvent({ type: "postback", replyToken: `r${++tokenSeq}`, source, postback: { data } }, { key: KEY });
const sendLocation = (gas, source, lat, lon, title = "") => gas.lineEvent({ type: "message", replyToken: `r${++tokenSeq}`, source, message: { type: "location", id: "m", latitude: lat, longitude: lon, title, address: "" } }, { key: KEY });
const lastReply = (gas) => gas.replies().filter((r) => r.kind === "reply").at(-1);
const textsOf = (messages) => messages.map((m) => (m.type === "text" ? m.text : m.altText)).join("\n");
const quickLabels = (message) => (message.quickReply?.items || []).map((i) => i.action.label);
const errorsOf = (messages) => checkMessages(messages).filter((p) => p.level === "error");

// 持ち主（か、許した人）が地点を1つ足す
function addPlace(gas, source, lat = 35.171, lon = 136.884, title = "") {
  press(gas, source, "a=add");
  sendLocation(gas, source, lat, lon, title);
  return lastReply(gas);
}

// ---- そらくると同じ目安 ----

test("気圧の目安は、そらくるの js/meteo.js と同じ答え（段階・時間帯のまとめ・言い方）", () => {
  const gas = makeBot();
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 300; i++) {
    const change = Math.round((rand() * 10 - 5) * 10) / 10;
    assert.equal(gas.call("soraqruLevelOf_", change), M.levelOf(change), String(change));
  }
  for (const bad of [null, undefined, "", "x", NaN]) assert.equal(gas.call("soraqruLevelOf_", bad), M.levelOf(bad));
  assert.deepEqual(JSON.parse(JSON.stringify(gas.eval("SORAQRU_LEVELS_"))), M.LEVELS);
  for (let n = 0; n < 40; n++) {
    const rows = Array.from({ length: 24 }, (_, hour) => {
      const change = rand() < 0.1 ? null : Math.round((rand() * 8 - 4) * 10) / 10;
      return { hour, change, level: M.levelOf(change) };
    });
    const mine = JSON.parse(JSON.stringify(gas.call("soraqruAlertRanges_", rows)));
    assert.deepEqual(mine, M.alertRanges(rows));
    assert.deepEqual(mine.map((r) => gas.call("soraqruRangeText_", r)), M.alertRanges(rows).map(M.rangeText));
  }
});

test("予報の読みこみ：3時間前とくらべる（そらくると同じ値）。壊れた・欠けた返事は null", () => {
  const gas = makeBot();
  const json = forecastJson({ pressure: (di, h) => (di === 1 && h >= 12 ? 1013 - (h - 11) * 1.2 : 1013) });
  const mine = gas.call("parseForecast_", json).days[jstDay(0)];
  const theirs = M.dayRows(M.parseForecast(json, new Date()), 0, new Date());
  assert.deepEqual(mine.map((r) => [r.hour, r.change, r.level]), theirs.map((r) => [r.hour, r.change, r.level]));
  for (const bad of [null, 1, "x", {}, { hourly: null }, { hourly: { time: "x", pressure_msl: [] } }, { hourly: { time: [], pressure_msl: [] } }]) {
    assert.equal(gas.call("parseForecast_", bad), null, JSON.stringify(bad));
  }
});

test("知らせること：雨（6〜21時に60%以上）・気圧（注意から）・気温（前の日より5℃）。何もない日は []", () => {
  const gas = makeBot();
  const today = jstDay(0);
  const evaluate = (o) => JSON.parse(JSON.stringify(gas.call("evaluateNotice_", gas.call("parseForecast_", forecastJson(o)), today)));
  assert.deepEqual(evaluate({}), []);
  // 夜中（5時・22時）の雨は数えない
  assert.deepEqual(evaluate({ pop: (di, h) => (di === 1 && (h === 5 || h === 22) ? 90 : 10) }), []);
  const rain = evaluate({ pop: (di, h) => (di === 1 && h >= 12 && h <= 14 ? 70 : 10) });
  assert.deepEqual(rain, [{ kind: "rain", emoji: "☔", title: "雨", lines: ["12〜15時 雨 70%"] }]);
  // やや注意だけなら送らない
  assert.deepEqual(evaluate({ pressure: (di, h) => (di === 1 && h >= 12 ? 1013 - (h - 11) * 0.5 : 1013) }), []);
  const pressure = evaluate({ pressure: (di, h) => (di === 1 && h >= 12 ? 1013 - (h - 11) * 1.2 : 1013) });
  assert.equal(pressure[0].kind, "pressure");
  assert.equal(pressure[0].lines[0], "12〜24時 警戒（下がる）");
  const cold = evaluate({ max: [20, 13, 15] });
  assert.deepEqual(cold, [{ kind: "temp", emoji: "🥶", title: "気温", lines: ["最高 13℃（前の日より 7℃ 低い）"] }]);
});

// ---- 入口：合言葉 ----

test("Webhook の合言葉がない・ちがう呼び出しは何もしない（返事もしない）", () => {
  const gas = makeBot();
  gas.lineEvent({ type: "message", replyToken: "r", source: userSource(OWNER), message: { type: "text", text: "天気の知らせ" } });
  gas.lineEvent({ type: "message", replyToken: "r", source: userSource(OWNER), message: { type: "text", text: "天気の知らせ" } }, { key: "wrong" });
  assert.equal(gas.replies().length, 0);
  // 合言葉が決まっていないボットも、何もしない
  const fresh = makeBot({ properties: { WEBHOOK_KEY: "" } });
  fresh.lineEvent({ type: "follow", replyToken: "r", source: userSource(OWNER) }, { key: "" });
  assert.equal(fresh.replies().length, 0);
  // 壊れた本文でも止まらない
  assert.deepEqual(gas.call("doPost", { parameter: { key: KEY }, postData: { contents: "{" } }).getContent(), "{}");
});

// ---- 役割：持ち主・許した人・知らない人 ----

test("友だちになったとき：持ち主・まだ持ち主がいない・知らない人で、案内とボタンがちがう", () => {
  const gas = makeBot();
  gas.lineEvent({ type: "follow", replyToken: "r1", source: userSource(OWNER) }, { key: KEY });
  assert.ok(quickLabels(lastReply(gas).messages[0]).includes("📍 地点を足す"));
  gas.lineEvent({ type: "follow", replyToken: "r2", source: userSource(STRANGER) }, { key: KEY });
  assert.deepEqual(quickLabels(lastReply(gas).messages[0]), ["🙋 使いたいと伝える"]);
  const fresh = makeBot({ properties: { OWNER_USER_ID: "" } });
  fresh.lineEvent({ type: "follow", replyToken: "r3", source: userSource(STRANGER) }, { key: KEY });
  assert.deepEqual(quickLabels(lastReply(fresh).messages[0]), ["🔑 持ち主の登録"]);
  assert.deepEqual(errorsOf(gas.replies().flatMap((r) => r.messages)), []);
});

test("持ち主の登録：LINE で押すだけではなれない。10分以内に GAS エディタで adoptOwner を実行して決まる", () => {
  const gas = makeBot({ properties: { OWNER_USER_ID: "" } });
  press(gas, userSource(STRANGER), "a=owner");
  assert.match(textsOf(lastReply(gas).messages), /adoptOwner/);
  assert.equal(gas.properties.OWNER_USER_ID, "");
  assert.equal(gas.call("adoptOwner"), true);
  assert.equal(gas.properties.OWNER_USER_ID, STRANGER);
  // 候補は1回きり
  assert.equal(gas.call("adoptOwner"), false);
  // 10分すぎた候補は使わない
  gas.properties.OWNER_CANDIDATE = JSON.stringify({ userId: FRIEND, at: Date.now() - 11 * 60e3 });
  assert.equal(gas.call("adoptOwner"), false);
  assert.equal(gas.properties.OWNER_USER_ID, STRANGER);
  // グループでは受けつけない
  press(gas, groupSource(FRIEND), "a=owner");
  assert.equal(gas.properties.OWNER_CANDIDATE, undefined);
});

test("知らない人は地点を足せない。「🙋 使いたい」で持ち主に知らせ、持ち主が「✅ 許す」と使える", () => {
  const gas = makeBot();
  press(gas, userSource(STRANGER), "a=add");
  assert.match(textsOf(lastReply(gas).messages), /持ち主の許可が要ります/);
  sendLocation(gas, userSource(STRANGER), 35.17, 136.88);
  assert.equal((gas.rows("地点") || []).length <= 1, true);

  press(gas, userSource(STRANGER), "a=request");
  const toOwner = gas.replies().filter((r) => r.kind === "push" && r.to === OWNER).at(-1);
  assert.ok(toOwner, "持ち主に知らせが届く");
  // 許すのは1回きりの操作なので、クイックリプライだけ（カードのボタンにしない）
  assert.equal(toOwner.messages[0].type, "text");
  assert.deepEqual(quickLabels(toOwner.messages[0]), ["✅ 許す", "やめておく"]);
  // 同じ日にもう一度押しても、持ち主にはもう送らない（push を使いすぎない）
  const pushes = gas.replies().filter((r) => r.kind === "push").length;
  press(gas, userSource(STRANGER), "a=request");
  assert.equal(gas.replies().filter((r) => r.kind === "push").length, pushes);

  // 持ち主でない人が「許す」の postback を作って送っても、何も変わらない
  const allow = toOwner.messages[0].quickReply.items[0].action.data;
  press(gas, userSource(FRIEND), allow);
  assert.match(textsOf(lastReply(gas).messages), /持ち主だけ/);
  assert.equal(gas.call("roleOf_", STRANGER), "");

  press(gas, userSource(OWNER), allow);
  assert.equal(gas.call("roleOf_", STRANGER), "member");
  assert.ok(gas.replies().some((r) => r.kind === "push" && r.to === STRANGER), "許された人に知らせる");
  const reply = addPlace(gas, userSource(STRANGER));
  assert.match(textsOf(reply.messages), /名古屋市中村区 を登録しました/);
});

test("持ち主は「👥 使う人」からやめさせられる。その人の地点の知らせも止まる", () => {
  const gas = makeBot({ members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, userSource(FRIEND));
  press(gas, userSource(OWNER), "a=members");
  const card = lastReply(gas).messages[0];
  assert.equal(card.type, "flex");
  assert.ok(quickLabels(card).includes("🚫 ともだち"));
  press(gas, userSource(OWNER), card.quickReply.items[0].action.data);
  assert.equal(gas.call("roleOf_", FRIEND), "");
  assert.equal(gas.call("activeNotices_").length, 0);
  // 前の「🚫」がまた押されても、やさしく返す
  press(gas, userSource(OWNER), card.quickReply.items[0].action.data);
  assert.match(textsOf(lastReply(gas).messages), /もう使えない/);
});

// ---- 地点 ----

test("地点を足す：「📍 地点を足す」を押した人の位置情報だけ。1km に丸める・地名は国土地理院とそらくるの表", () => {
  const gas = makeBot();
  // 押していない人の位置情報は登録しない
  sendLocation(gas, userSource(OWNER), 35.17, 136.88);
  assert.equal(gas.call("activeNotices_").length, 0);
  const reply = addPlace(gas, userSource(OWNER), 35.17123, 136.88456);
  const [notice] = gas.call("activeNotices_");
  assert.equal(notice.lat, 35.17);
  assert.equal(notice.lon, 136.88);
  assert.equal(notice.placeName, "名古屋市中村区");
  assert.equal(notice.notifyHour, 7);
  assert.equal(notice.targetId, OWNER);
  // 時間はクイックリプライで選べる（打ちこまなくてよい）
  assert.deepEqual(quickLabels(reply.messages[0]), ["⏰ 6時", "⏰ 7時", "⏰ 8時", "⏰ 21時（明日のぶん）"]);
  // 同じ場所は1つ
  addPlace(gas, userSource(OWNER), 35.171, 136.884);
  assert.match(textsOf(lastReply(gas).messages), /もう登録しています/);
  assert.equal(gas.call("activeNotices_").length, 1);
});

test("地点は1人3か所まで。地名が読めないときは位置情報の題（式にならないように）", () => {
  const gas = makeBot();
  gas.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => (url.startsWith("https://mreversegeocoder") ? response(500, "") : orig(url, opt)))(gas.ctx.UrlFetchApp.fetch);
  addPlace(gas, userSource(OWNER), 35.1, 136.1, "=HYPERLINK(\"https://example.com\",\"x\")");
  addPlace(gas, userSource(OWNER), 35.2, 136.2, "職場");
  addPlace(gas, userSource(OWNER), 35.3, 136.3, "");
  // 本物のシートは、書くときに付けた先頭の ' を、読むときに外す（偽物のシートは外さないので、ここで外して比べる）
  const names = gas.call("activeNotices_").map((n) => n.placeName.replace(/^'/, ""));
  assert.ok(names[0].startsWith("=HYPERLINK("), names[0]);
  assert.deepEqual(names.slice(1), ["職場", "登録した地点"]);
  assert.deepEqual(gas.formulaCells(), []);
  press(gas, userSource(OWNER), "a=add");
  assert.match(textsOf(lastReply(gas).messages), /1人3か所まで/);
});

test("時間をかえる・やめる：選ぶのはクイックリプライ。ほかの人の地点・やめた地点はさわれない", () => {
  const gas = makeBot({ members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, groupSource(OWNER), 35.17, 136.88);
  const [notice] = gas.call("activeNotices_");
  assert.equal(notice.targetType, "group");
  // 許した人でも、持ち主が足した地点は変えられない
  press(gas, groupSource(FRIEND), "a=pick&m=time");
  assert.match(textsOf(lastReply(gas).messages), /変えられる地点は/);
  press(gas, groupSource(FRIEND), `a=time&id=${notice.noticeId}&h=21`);
  assert.equal(gas.call("activeNotices_")[0].notifyHour, 7);
  // 持ち主は変えられる
  press(gas, groupSource(OWNER), "a=pick&m=time");
  assert.deepEqual(quickLabels(lastReply(gas).messages[0]), ["⏰ 名古屋市中村区"]);
  press(gas, groupSource(OWNER), `a=time&id=${notice.noticeId}&h=21`);
  assert.equal(gas.call("activeNotices_")[0].notifyHour, 21);
  press(gas, groupSource(OWNER), `a=time&id=${notice.noticeId}&h=13`);
  assert.match(textsOf(lastReply(gas).messages), /えらべません/);
  press(gas, groupSource(OWNER), `a=remove&id=${notice.noticeId}`);
  assert.equal(gas.call("activeNotices_").length, 0);
  // やめた地点の古いボタン
  press(gas, groupSource(OWNER), `a=remove&id=${notice.noticeId}`);
  assert.match(textsOf(lastReply(gas).messages), /もうやめています/);
});

test("グループでは、決まった言葉にだけ返す（ふだんの会話にまじらない）", () => {
  const gas = makeBot();
  say(gas, groupSource(OWNER), "今日は雨かな");
  assert.equal(gas.replies().length, 0);
  say(gas, groupSource(OWNER), "天気の知らせ");
  assert.equal(lastReply(gas).messages[0].type, "flex");
});

// ---- 決めた時間の知らせ ----

// その時間（日本時間）の Date
const at = (hour, dayOffset = 0) => new Date(`${jstDay(dayOffset)}T${String(hour).padStart(2, "0")}:05:00+09:00`);

test("決めた時間に、知らせることがある日だけ push。同じ地点は1回だけ聞く。同じ日に2回は送らない", () => {
  const rainy = forecastJson({ pop: (di, h) => (di === 1 && h >= 12 && h <= 14 ? 70 : 10) });
  const gas = makeBot({ forecast: rainy, members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  addPlace(gas, userSource(FRIEND), 35.17, 136.88);
  gas.reset();
  // ちがう時間には見ない
  assert.equal(gas.call("runNotices_", at(6)).checked, 0);
  const result = gas.call("runNotices_", at(7));
  assert.equal(result.sent, 2);
  assert.equal(gas.fetches.filter((f) => f.url.startsWith("https://api.open-meteo.com/")).length, 1);
  const pushes = gas.replies().filter((r) => r.kind === "push");
  assert.deepEqual(pushes.map((p) => p.to).sort(), [FRIEND, OWNER].sort());
  const card = pushes[0].messages[0];
  assert.match(card.altText, /^☔ 名古屋市中村区：12〜15時 雨 70%$/);
  assert.deepEqual(errorsOf([card]), []);
  // ボタンは、その地点が開くそらくるのリンク（あとで押されても困らない）
  const button = card.contents.footer.contents[0].action;
  assert.equal(button.type, "uri");
  assert.match(button.uri, /^https:\/\/katsuan\.github\.io\/soraqru\/\?at=35\.17,136\.88&name=/);
  assert.match(JSON.stringify(card), /Open-Meteo\.com（CC BY 4\.0）/);
  assert.doesNotMatch(JSON.stringify(card), /頭痛/);
  // もう一度動いても、同じ日には送らない
  assert.equal(gas.call("runNotices_", at(7)).sent, 0);
});

test("何もない日は送らない。21時は明日のぶん", () => {
  const tomorrowRain = forecastJson({ pop: (di, h) => (di === 2 && h === 9 ? 80 : 10) });
  const gas = makeBot({ forecast: tomorrowRain });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  const [notice] = gas.call("activeNotices_");
  press(gas, userSource(OWNER), `a=time&id=${notice.noticeId}&h=21`);
  gas.call("updateRow_", "notices", "noticeId", notice.noticeId, { notifyHour: 7 });
  gas.reset();
  assert.equal(gas.call("runNotices_", at(7)).sent, 0, "今日は何もない");
  gas.call("updateRow_", "notices", "noticeId", notice.noticeId, { notifyHour: 21, lastCheckedDate: "" });
  assert.equal(gas.call("runNotices_", at(21)).sent, 1);
  const card = gas.replies().filter((r) => r.kind === "push")[0].messages[0];
  assert.match(JSON.stringify(card.contents.header), /明日の天気の知らせ/);
});

test("Open-Meteo に断られたら（429）1回だけやりなおす。それでもだめなら送らずに記録", () => {
  let calls = 0;
  const gas = makeBot({ meteo: () => (++calls, response(429, "{}")) });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  gas.reset();
  const result = gas.call("runNotices_", at(7));
  assert.equal(calls, 2);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(gas.replies().filter((r) => r.kind === "push").length, 0);
  assert.ok(gas.rows("動作の記録").some((row) => /Open-Meteo 429/.test(row[2])));
  // 2回目でとおれば送る
  let n = 0;
  const ok = makeBot({ meteo: () => (++n === 1 ? response(429, "{}") : response(200, forecastJson({ pop: (di, h) => (di === 1 && h === 12 ? 90 : 10) }))) });
  addPlace(ok, userSource(OWNER), 35.17, 136.88);
  assert.equal(ok.call("runNotices_", at(7)).sent, 1);
});

test("今月の push が上限の8割をこえたら送らない。許されなくなった人の地点にも送らない", () => {
  const rainy = forecastJson({ pop: (di, h) => (di === 1 && h === 12 ? 90 : 10) });
  const full = makeBot({ forecast: rainy, quota: { value: 200, used: 170 } });
  addPlace(full, userSource(OWNER), 35.17, 136.88);
  full.reset();
  const result = full.call("runNotices_", at(7));
  assert.equal(result.skippedForQuota, 1);
  assert.equal(full.replies().filter((r) => r.kind === "push").length, 0);

  const gas = makeBot({ forecast: rainy, members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, userSource(FRIEND), 35.17, 136.88);
  gas.call("updateRow_", "members", "userId", FRIEND, { status: "removed" });
  gas.reset();
  assert.equal(gas.call("runNotices_", at(7)).checked, 0);
});

test("カードが断られたら、文で送りなおす（返事の合図は2回使わない）", () => {
  const gas = makeBot();
  gas.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => (/message\/reply$/.test(url) ? (orig(url, opt), response(400, { message: "invalid" })) : orig(url, opt)))(gas.ctx.UrlFetchApp.fetch);
  say(gas, userSource(OWNER), "天気の知らせ");
  assert.deepEqual(gas.reusedReplyTokens(), []);
  const push = gas.replies().filter((r) => r.kind === "push").at(-1);
  assert.equal(push.messages[0].type, "text");
  assert.match(push.messages[0].text, /文で送りました/);
});

// ---- #テスト（持ち主だけ） ----

test("#テスト：持ち主の1対1 だけ。見本はすべて 🧪 付き・reply だけ・シートに書かない", () => {
  const gas = makeBot();
  say(gas, userSource(STRANGER), "#テスト");
  assert.doesNotMatch(textsOf(lastReply(gas).messages), /🧪/);
  say(gas, groupSource(OWNER), "#テスト");
  assert.equal(gas.replies().length, 1);
  say(gas, userSource(OWNER), "＃てすと");
  const card = lastReply(gas).messages[0];
  assert.match(card.altText, /^🧪/);
  const before = JSON.stringify([gas.rows("地点"), gas.rows("使う人")]);
  for (const action of card.quickReply.items.map((i) => i.action.data)) {
    gas.reset();
    press(gas, userSource(OWNER), action);
    const replies = gas.replies();
    assert.ok(replies.every((r) => r.kind === "reply"), `${action} は reply だけ`);
    const messages = replies.flatMap((r) => r.messages);
    assert.ok(messages.length >= 1 && messages.length <= 5);
    for (const m of messages) assert.match(m.type === "text" ? m.text : m.altText, /^🧪/, action);
    assert.deepEqual(errorsOf(messages), [], action);
  }
  assert.equal(JSON.stringify([gas.rows("地点"), gas.rows("使う人")]), before);
  // ほかの人が #テスト の postback を作って送っても、見本は出ない
  press(gas, userSource(STRANGER), "a=test&t=notice");
  assert.doesNotMatch(textsOf(lastReply(gas).messages), /🧪/);
});

test("季節の絵文字：出る・出ない（#テスト）", () => {
  const gas = makeBot();
  press(gas, userSource(OWNER), "a=test&t=season_on");
  const on = lastReply(gas).messages[0].text;
  press(gas, userSource(OWNER), "a=test&t=season_off");
  const off = lastReply(gas).messages[0].text;
  assert.notEqual(on, off);
  assert.match(off, /登録しました。$/);
});

// ---- どのカード・クイックリプライも LINE が受けつける形 ----

test("返事のカード・クイックリプライは LINE が受けつける形（ラベル20字・13個まで・ボタン2つまで）", () => {
  const gas = makeBot({ members: [[FRIEND, "とても長い名前のともだちさんです", "allowed", "", ""]] });
  addPlace(gas, userSource(OWNER));
  say(gas, userSource(OWNER), "天気の知らせ");
  press(gas, userSource(OWNER), "a=members");
  press(gas, userSource(OWNER), "a=edit");
  gas.lineEvent({ type: "follow", replyToken: "rf", source: userSource(STRANGER) }, { key: KEY });
  const messages = gas.replies().flatMap((r) => r.messages);
  assert.deepEqual(errorsOf(messages), []);
  for (const m of messages) {
    if (m.type === "flex") {
      assert.ok(m.altText && !/カードが届きました/.test(m.altText));
      const footer = m.contents.footer?.contents || [];
      assert.ok(footer.length <= 2);
      // カードのボタンは、URL を開くか、聞き返すだけ（1回きりの操作を置かない）
      for (const b of footer) assert.ok(b.action.type === "uri" || /^a=(add|edit|menu|test)/.test(b.action.data), JSON.stringify(b.action));
    }
  }
  assert.deepEqual(gas.formulaCells(), []);
});

// ---- 配布用シートに鍵を入れない ----

test("配布用のファイルに、鍵・LINE の ID・シートの ID を書いていない", () => {
  const files = fs.readdirSync(GAS_DIR).filter((f) => /\.(gs|json)$/.test(f));
  for (const f of files) {
    const text = fs.readFileSync(path.join(GAS_DIR, f), "utf8");
    assert.doesNotMatch(text, /U[0-9a-f]{32}/, f);
    assert.doesNotMatch(text, /[A-Za-z0-9+/]{100,}={0,2}/, f); // チャネルアクセストークンのような長い文字
    assert.doesNotMatch(text, /docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/, f);
    assert.doesNotMatch(text, /script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, f);
  }
  assert.ok(!fs.existsSync(path.join(GAS_DIR, ".clasp.json")) || fs.readFileSync(path.join(GAS_DIR, "../.gitignore"), "utf8").includes("gas/.clasp.json"));
});
