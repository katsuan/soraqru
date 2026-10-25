// そらくる（SoraQru）：画面の操作。天気は Open-Meteo だけ（js/meteo.js）、地点と結果はこの端末の中だけ（js/store.js）
import {
  LEVELS, dayInfo, dayLabel, dayRows, daySummary, deg, forecastUrl, geocodeUrls, localHour, localYmd, addDays, parseForecast, parseGeocode,
  validLatLon, weatherOf, parseTarget, daysFromToday, FORECAST_MAX_DAYS
} from "./js/meteo.js?v=202610251057";
import { MAX_NAME, MAX_PLACES, PLACE_EMOJIS, addPlace, cached, cleanName, load, putCache, removePlace, restorePlace, save, blank, KEY } from "./js/store.js?v=202610251057";
import { cardParams, dayCard } from "./js/card.js?v=202610251057";
import { fineLatLon, placeName } from "./js/place-name.js?v=202610251057";

const $ = (id) => document.getElementById(id);
const FETCH_TIMEOUT_MS = 10000;
// 開いたツールの名前（?from=）。知らない名前は使わない（ui を作るときに readVisit が読むので、ここに置く）
const FROM_TOOLS = { yuqsaki: "ゆくさき", saqsen: "さくせん盤", qlovebot: "くらぶボット", kazoq: "KazoQ" };

let state = load();
const ui = {
  visit: readVisit(), // 受けとったリンクの地点（覚えるまで、ここだけ）
  picked: null, // 地名で探して選んだ地点
  emoji: PLACE_EMOJIS[1],
  geo: "", // 現在地のようす（""・"wait"・"denied"・"none"）
  shown: null, // いま出している { place, data, at }
  seq: 0
};

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function persist() {
  if (!save(state)) say("この端末に残せませんでした（プライベートブラウズでは、閉じると消えます）");
}

// 季節の絵文字をときどき文の後ろに（Q キットの season.js。まだ読めていなければ、そのまま）
const cheer = (text) => (window.QSeason ? window.QSeason.decorate(text) : text);

function say(text, undo) {
  if (window.LineShareUI?.toast) {
    window.LineShareUI.toast(text, undo ? { actionLabel: "元に戻す", onAction: undo } : {});
    return;
  }
  $("status").textContent = text;
  clearTimeout(say.timer);
  if (text) say.timer = setTimeout(() => ($("status").textContent = ""), 3500);
}

// ?at=35.17,136.88&name=名古屋（送ってもらったカードのボタン）。形を確かめて読む
// ほかのツール（ゆくさき・さくせん盤など）からは、場所の名前でも開ける（?q=那覇&date=2026-11-01&hour=13）。
// date・hour は「見たい日」（target）。今日・明日ならその札に印、それより先（16日先まで）はその日の天気を一番上に
function readVisit() {
  const q = new URLSearchParams(location.search);
  const target = parseTarget(q.get("date"), q.get("hour"));
  const at = String(q.get("at") || "").split(",");
  const ll = at.length === 2 ? validLatLon(at[0], at[1]) : null;
  const name = cleanName(q.get("name"));
  const from = Object.prototype.hasOwnProperty.call(FROM_TOOLS, q.get("from")) ? FROM_TOOLS[q.get("from")] : "";
  if (ll) return { id: "visit", name: name || "送ってもらった地点", emoji: "📍", ...ll, src: "search", target, from };
  const query = cleanName(q.get("q"), 40);
  if (query) return { id: "visit", name: name || cleanName(query), emoji: "📍", query, lat: null, lon: null, src: "search", target, from };
  return null;
}

// いま見ている地点（visit・現在地・覚えた地点）。現在地は { id: "here" }
function currentPlace() {
  if (ui.visit) return ui.visit;
  return state.places.find((p) => p.id === state.current) || { id: "here", name: "現在地", emoji: "📍", src: "gps", ...(state.here || {}) };
}

// ---- 地点の切りかえ ----
function renderPlaceBar() {
  const cur = ui.visit ? "visit" : state.current;
  const chip = (id, emoji, name) => `<button class="ls-chip is-small" type="button" aria-pressed="${cur === id}" data-place="${esc(id)}">${esc(emoji)} ${esc(name)}</button>`;
  $("placeBar").innerHTML =
    chip("here", "📍", "現在地") +
    state.places.map((p) => chip(p.id, p.emoji, p.name)).join("") +
    (state.places.length < MAX_PLACES ? '<button class="ls-chip is-small add-chip" type="button" data-add>＋ 地点</button>' : "");
  $("placesMeta").textContent = state.places.length ? `${state.places.length}か所` : "";
  $("placeList").innerHTML = state.places.length
    ? state.places
        .map((p) => `<li><span>${esc(p.emoji)} ${esc(p.name)}</span><button class="ls-button is-small" type="button" data-rename="${esc(p.id)}">✏️ 呼び名</button><button class="mini" type="button" data-remove="${esc(p.id)}" aria-label="${esc(p.name)}を消す">✕</button></li>`)
        .join("")
    : '<li class="ls-hint">まだありません。上の「＋ 地点」から足せます。</li>';
}

// 送ってもらった地点の表示をやめる。アドレスの ?at= も消す（開きなおしても、また出ないように）
function leaveVisit() {
  if (!ui.visit) return;
  ui.visit = null;
  $("visitPanel").hidden = true;
  history.replaceState(null, "", location.pathname);
}

$("placeBar").addEventListener("click", (e) => {
  if (e.target.closest("[data-add]")) return openAdd();
  const b = e.target.closest("[data-place]");
  if (!b) return;
  leaveVisit();
  state.current = b.dataset.place;
  persist();
  closeAdd();
  show();
});

// ---- 地点を足す ----
function openAdd(note = "") {
  $("addPanel").hidden = false;
  $("geoNote").hidden = !note;
  $("geoNote").textContent = note;
  $("useHere").hidden = ui.geo === "denied" || ui.geo === "none";
  // 現在地が使えず、覚えた地点もないときは、閉じても見るものがないので「やめる」を出さない
  $("addCancel").hidden = !state.places.length && ui.geo !== "" && ui.geo !== "wait";
  if (!note) $("searchInput").focus();
}
function closeAdd() {
  $("addPanel").hidden = true;
  $("results").innerHTML = "";
  $("nameBox").hidden = true;
  $("searchError").hidden = true;
  $("searchInput").value = "";
  ui.picked = null;
}
$("addCancel").addEventListener("click", closeAdd);

function renderEmojiPick() {
  $("emojiPick").innerHTML = PLACE_EMOJIS.map(
    (e) => `<button class="ls-chip emoji" type="button" role="radio" aria-checked="${e === ui.emoji}" data-emoji="${e}" aria-label="${e}">${e}</button>`
  ).join("");
}
$("emojiPick").addEventListener("click", (e) => {
  const b = e.target.closest("[data-emoji]");
  if (!b) return;
  ui.emoji = b.dataset.emoji;
  renderEmojiPick();
});

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("searchInput").value.trim();
  const err = $("searchError");
  err.hidden = true;
  $("nameBox").hidden = true;
  if (!text) {
    err.textContent = "地名を入れてね";
    err.hidden = false;
    return;
  }
  $("results").innerHTML = '<li class="ls-hint">探しています…</li>';
  try {
    const jsons = await Promise.all(geocodeUrls(text).map((url) => getJson(url)));
    const list = parseGeocode(...jsons);
    ui.results = list;
    $("results").innerHTML = list.length
      ? list.map((r, i) => `<li><button class="ls-button is-block result" type="button" data-result="${i}">📍 ${esc(r.name)}<small>${esc(r.sub)}</small></button></li>`).join("")
      : "";
    if (!list.length) {
      err.textContent = `「${text}」が見つかりませんでした。市や町の名前で探してみてね`;
      err.hidden = false;
    }
  } catch {
    $("results").innerHTML = "";
    err.textContent = navigator.onLine === false ? "電波がつながらないので探せません" : "探せませんでした。少しあとで、もう一度ためしてね";
    err.hidden = false;
  }
});

$("results").addEventListener("click", (e) => {
  const b = e.target.closest("[data-result]");
  if (!b) return;
  pickPlace({ ...ui.results[Number(b.dataset.result)], src: "search" });
});

function pickPlace(p) {
  ui.picked = p;
  $("results").querySelectorAll("[data-result]").forEach((x) => x.setAttribute("aria-pressed", String(ui.results?.[Number(x.dataset.result)] === p)));
  $("pickedName").textContent = p.name;
  $("placeName").value = p.src === "search" ? cleanName(p.name) : "";
  ui.emoji = p.src === "gps" ? "🏠" : "📍";
  renderEmojiPick();
  $("nameBox").hidden = false;
  $("placeName").focus();
}

$("savePlace").addEventListener("click", () => {
  if (!ui.picked) return;
  const place = addPlace(state, { ...ui.picked, name: $("placeName").value || ui.picked.name, emoji: ui.emoji });
  if (!place) return say(`地点は ${MAX_PLACES} か所までです`);
  state.current = place.id;
  persist();
  closeAdd();
  say(cheer(`${place.emoji} ${place.name} を覚えました`));
  show();
});

$("useHere").addEventListener("click", async () => {
  $("useHere").disabled = true;
  const ll = await locate();
  const name = ll ? cleanName(await placeName(...nameSpot(ll))) : "";
  $("useHere").disabled = false;
  if (!ll) return openAdd(geoMessage());
  pickPlace({ name: name || "いまの場所", ...ll, src: "gps" });
});

// 受けとった地点を覚える
$("visitSave").addEventListener("click", () => {
  const place = addPlace(state, { ...ui.visit, emoji: "📍" });
  if (!place) return say(`地点は ${MAX_PLACES} か所までです`);
  leaveVisit();
  state.current = place.id;
  persist();
  say(cheer(`${place.emoji} ${place.name} を覚えました`));
  show();
});
$("visitClose").addEventListener("click", () => {
  leaveVisit();
  show();
});

// ---- 覚えた地点（呼び名・消す） ----
$("placeList").addEventListener("click", async (e) => {
  const rename = e.target.closest("[data-rename]");
  if (rename) {
    const p = state.places.find((x) => x.id === rename.dataset.rename);
    if (!p) return;
    const name = await window.LineShareUI?.ask({ title: "呼び名", input: p.name, ok: "決める", maxLength: MAX_NAME });
    if (name === null || name === undefined || !cleanName(name)) return;
    p.name = cleanName(name);
    persist();
    // 一覧と、いま出している地点の名前・送るカードだけ描きなおす（天気は取りなおさない）
    renderPlaceBar();
    if (ui.shown && ui.shown.place.id === p.id) {
      ui.shown.place = p;
      $("nowPlace").textContent = `${p.emoji} ${p.name}`;
      renderSend();
    }
    return;
  }
  const remove = e.target.closest("[data-remove]");
  if (!remove) return;
  const wasCurrent = state.current === remove.dataset.remove;
  const undo = removePlace(state, remove.dataset.remove);
  if (!undo) return;
  persist();
  if (wasCurrent) show();
  else renderPlaceBar();
  say(`🗑 ${undo.place.name} を消しました`, () => {
    restorePlace(state, undo);
    if (wasCurrent) state.current = undo.place.id;
    persist();
    show();
  });
});

$("clearAll").addEventListener("click", async () => {
  const ok = await window.LineShareUI?.ask({
    title: "この端末の記録をすべて消しますか？",
    text: "覚えた地点と、天気の結果を消します。元に戻せません。",
    ok: "消す",
    danger: true
  });
  if (!ok) return;
  state = blank();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 消すだけ
  }
  say("すべて消しました");
  show();
});

// ---- 現在地 ----
function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      ui.geo = "none";
      return resolve(null);
    }
    ui.geo = "wait";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        ui.geo = "";
        const ll = validLatLon(pos.coords.latitude, pos.coords.longitude);
        // 地名を調べるときだけ使う、100m くらいの位置（端末には残さない。js/place-name.js）
        ui.fine = ll ? fineLatLon(pos.coords.latitude, pos.coords.longitude) : null;
        resolve(ll);
      },
      (err) => {
        ui.geo = err && err.code === 1 ? "denied" : "none";
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

function geoMessage() {
  return ui.geo === "denied"
    ? "位置情報が使えないので、現在地の天気を出せません。地名で探すか、覚えた地点を選んでね。"
    : "現在地がわかりませんでした。地名で探すか、覚えた地点を選んでね。";
}

// ---- 天気を取る ----
async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 地点を出す：覚えている結果を先に出し（B1）、古ければ（1時間）聞きなおす
async function show() {
  const seq = ++ui.seq;
  renderPlaceBar();
  $("visitPanel").hidden = !ui.visit;
  if (ui.visit) {
    const t = ui.visit.target;
    $("visitFrom").textContent = ui.visit.from ? `${ui.visit.from}で開いた` : "送ってもらった";
    $("visitName").textContent = ui.visit.name;
    $("visitWhen").textContent = t ? `の ${dayLabel(t.date)}${t.hour === null ? "" : ` ${t.hour}時ごろ`}の天気` : "";
  }
  // 場所の名前で開いたときは、先に探す（いちばんそれらしいもの。日本を先・人の多い順）
  if (ui.visit && ui.visit.query && ui.visit.lat === null) {
    renderWaiting("場所をさがしています");
    try {
      const list = parseGeocode(...(await Promise.all(geocodeUrls(ui.visit.query).map((url) => getJson(url)))));
      if (seq !== ui.seq) return;
      if (!list.length) return renderEmpty("🔎", `「${ui.visit.query}」の場所が見つかりませんでした。上の「＋ 地点」から探してね。`);
      Object.assign(ui.visit, { lat: list[0].lat, lon: list[0].lon });
    } catch {
      if (seq !== ui.seq) return;
      return renderEmpty("📡", "場所を探せませんでした。つながったら「もう一度」を押してね。", true);
    }
  }
  let place = currentPlace();
  $("nowPlace").textContent = `${place.emoji} ${place.name}`;

  if (place.id === "here") {
    // 前に取れた現在地の結果を先に出してから、いまの場所を聞く
    const before = state.here && cached(state, state.here.lat, state.here.lon);
    if (before) render(place, before.data, before.at, "");
    else renderWaiting("現在地をさがしています");
    const ll = await locate();
    if (seq !== ui.seq) return;
    if (!ll) {
      if (before) {
        render(place, before.data, before.at, `${geoMessage()}（前に取れた現在地の情報です）`);
      } else {
        renderEmpty("📍", ui.geo === "denied" ? "位置情報が使えないため、現在地の天気は出せません。" : "現在地がわかりませんでした。");
      }
      if (!state.places.length) openAdd(geoMessage());
      return;
    }
    // 同じ場所なら前に調べた地名をそのまま使い、ちがえば調べなおす（天気は待たせない）
    const same = state.here && state.here.lat === ll.lat && state.here.lon === ll.lon;
    state.here = same && state.here.name ? { ...ll, name: state.here.name, named: 2 } : ll;
    persist();
    place = currentPlace();
    if (!state.here.name) nameHere(ll);
  }
  await loadFor(place, seq);
}

// 地名を調べる位置：取ったばかりの 100m くらいの位置（同じ場所のとき）。なければ 1km に丸めた位置
function nameSpot(ll) {
  const f = ui.fine;
  return f && Math.abs(f.lat - ll.lat) < 0.006 && Math.abs(f.lon - ll.lon) < 0.006 ? [f.lat, f.lon] : [ll.lat, ll.lon];
}

// 現在地の地名を調べ、わかったら見出しを「📍 名古屋市中村区」に（わからなければ「現在地」のまま）
async function nameHere(ll) {
  const name = cleanName(await placeName(...nameSpot(ll)));
  if (!name || !state.here || state.here.lat !== ll.lat || state.here.lon !== ll.lon) return;
  state.here.name = name;
  state.here.named = 2;
  persist();
  if (state.current === "here" && !ui.visit) $("nowPlace").textContent = `📍 ${name}`;
}

async function loadFor(place, seq) {
  const hit = cached(state, place.lat, place.lon);
  if (hit) render(place, hit.data, hit.at, "");
  else renderWaiting("天気を読みこんでいます");
  if (hit?.fresh) return;
  if (navigator.onLine === false) {
    if (hit) render(place, hit.data, hit.at, `電波がないため、${timeLabel(hit.at)}の情報です`);
    else renderEmpty("📡", "電波がつながらないので、天気を読みこめません。つながったら「もう一度」を押してね。", true);
    return;
  }
  try {
    const data = parseForecast(await getJson(forecastUrl(place.lat, place.lon)));
    if (!data) throw new Error("読めない返事");
    putCache(state, place.lat, place.lon, data);
    persist();
    if (seq !== ui.seq) return;
    render(place, data, Date.now(), "");
  } catch {
    if (seq !== ui.seq) return;
    if (hit) render(place, hit.data, hit.at, `新しい情報を読みこめなかったため、${timeLabel(hit.at)}の情報です`);
    else renderEmpty("🌫️", "天気を読みこめませんでした。少しあとで「もう一度」を押してね。", true);
  }
}

$("retry").addEventListener("click", () => show());

const timeLabel = (ms) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ---- 描く ----
// 待っているあいだは経過秒数を出す（3秒をこえるものは理由も。ux.md の B2）
let stopProgress = () => {};
function renderWaiting(label) {
  stopProgress();
  ui.shown = null;
  $("nowPanel").setAttribute("aria-busy", "true");
  $("nowAt").textContent = "";
  $("nowBody").innerHTML = '<div class="ls-skeleton now-skeleton"></div><p class="ls-hint wait" id="waitText"></p>';
  const show = (text) => $("waitText") && ($("waitText").textContent = text);
  stopProgress = window.LineShareUI?.progress ? window.LineShareUI.progress(label, show, { slowAfter: 6, slowNote: "電波が弱いと、時間がかかることがあります。" }) : (show(`${label}…`), () => {});
  $("nowNote").hidden = true;
  $("retry").hidden = true;
  $("days").innerHTML = [0, 1].map(() => '<section class="ls-panel"><div class="ls-skeleton day-skeleton"></div></section>').join("");
  $("sendPanel").hidden = true;
}

function renderEmpty(icon, text, retry = false) {
  stopProgress();
  ui.shown = null;
  $("nowPanel").setAttribute("aria-busy", "false");
  $("nowAt").textContent = "";
  $("nowBody").innerHTML = `<div class="ls-empty"><span class="ls-empty-icon" aria-hidden="true">${esc(icon)}</span><p>${esc(text)}</p></div>`;
  $("nowNote").hidden = true;
  $("retry").hidden = !retry;
  $("days").innerHTML = "";
  $("sendPanel").hidden = true;
}

function render(place, data, at, note) {
  stopProgress();
  if (place.id === "here") place = currentPlace(); // あとからわかった地名（名古屋市中村区など）を使う
  ui.shown = { place, data, at, note };
  const now = new Date();
  const hour = localHour(now, data.offset);
  const today = dayRows(data, 0, now);
  const cur = today.find((r) => r.hour === hour) || today[0];
  $("nowPanel").setAttribute("aria-busy", "false");
  $("nowPlace").textContent = `${place.emoji} ${place.name}`;
  $("nowAt").textContent = `${timeLabel(at)}の情報`;
  $("nowNote").hidden = !note;
  $("nowNote").textContent = note;
  $("retry").hidden = !note;

  if (!cur) {
    $("nowBody").innerHTML = '<p class="ls-hint">今日の情報がまだありません。電波がつながったら「もう一度」を押してね。</p>';
    $("retry").hidden = false;
  } else {
    const w = weatherOf(cur.code, cur.day);
    const later = [...today, ...dayRows(data, 1, now)].find((r) => r.t > cur.t && r.hpa !== null && (Date.parse(`${r.t}:00Z`) - Date.parse(`${cur.t}:00Z`)) / 3600000 >= 3);
    const diff = later && cur.hpa !== null ? later.hpa - cur.hpa : 0;
    const trend = diff >= 1 ? "↗ 上がる" : diff <= -1 ? "↘ 下がる" : "→ 横ばい";
    const lv = cur.level === null ? null : LEVELS[cur.level];
    const info = dayInfo(data, 0, now);
    $("nowBody").innerHTML = `
      <div class="now-main">
        <span class="now-emoji" aria-hidden="true">${esc(w.emoji)}</span>
        <div>
          <p class="now-temp">${cur.temp === null ? "—" : esc(Math.round(cur.temp))}<small>℃</small></p>
          <p class="now-label"><span class="ls-nowrap">${esc(w.label)}</span>${info ? `<span>　最高 ${esc(deg(info.max))}／最低 ${esc(deg(info.min))}</span>` : ""}</p>
        </div>
      </div>
      <div class="now-hpa">
        <span class="level-pill" style="--c:${lv ? lv.color : "#9aa3b2"}">${lv ? esc(lv.label) : "—"}</span>
        <span><b>${cur.hpa === null ? "—" : esc(cur.hpa.toFixed(1))}</b> hPa</span>
        <span class="trend">${later ? `3時間後 ${esc(trend)}` : ""}</span>
      </div>`;
  }
  // 見たい日（ほかのツールから）：今日・明日ならその札に印。それより先は、その日の札を一番上に（読みこむまでは案内）
  const t = targetOf(place);
  const n = t ? daysFromToday(t.date, now, data.offset) : null;
  const ext = t && ui.extended && ui.extended.key === targetKey(place, t) ? ui.extended.data : null;
  const top = t && (n < 0 || n > 1) ? (ext ? dayHtml(ext, n, now, hour, t) : targetNoteHtml(t, n)) : "";
  $("days").innerHTML = top + [0, 1].map((i) => dayHtml(data, i, now, hour, t && n === i ? t : null)).join("");
  // 1時間ごとは、見たい時刻（なければ、今日のいまの時刻）から見えるように
  $("days").querySelectorAll(".hours").forEach((list) => {
    const cell = list.querySelector(".is-target") || list.querySelector(".is-now");
    if (cell) list.scrollLeft = Math.max(0, cell.offsetLeft - 8);
  });
  if (t && n > 1 && n < FORECAST_MAX_DAYS && !ext) loadTargetDay(place, t);

  $("sendPanel").hidden = false;
  renderSend();
  if (typeof renderNotifyBtn === "function") renderNotifyBtn();
}

// ---- カードで送る：送る日（今日・明日）を、カードの見本つきの札で選ぶシート ----
const sendSheet = $("sendSheet");
const PICKS = [
  { day: 0, input: "pickToday", preview: "previewToday" },
  { day: 1, input: "pickTomorrow", preview: "previewTomorrow" }
];

// おくるんのカードと同じ並び（色の帯に見出し・日付 → タイトル → 中身の枠）を小さく描く。文字は textContent で入れる
function previewCardEl(q) {
  const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? "" });
  const card = el("div", "cp");
  const head = el("div", "cp-head");
  head.style.background = q.get("customColor");
  head.append(el("b", "", q.get("headerTitle")), el("small", "", q.get("date")));
  const body = el("div", "cp-body");
  body.append(el("p", "cp-title", q.get("title")), el("p", "cp-detail", q.get("detail")));
  card.append(head, body);
  return card;
}

function openSend() {
  const s = ui.shown;
  if (!s) return;
  // 夜（18時から）は、明日のぶんだけを先に選んでおく
  const evening = localHour(new Date(), s.data.offset) >= 18;
  $("pickToday").checked = !evening;
  $("pickTomorrow").checked = true;
  for (const p of PICKS) $(p.preview).replaceChildren(previewCardEl(dayCard(s.place, s.data, p.day, new Date())));
  renderSend();
  sendSheet.hidden = false;
  // 2枚の見本は、高いほうに高さをそろえる（LINE でも横に並んだカードは同じ高さになる）
  const cards = [...sendSheet.querySelectorAll(".pick-preview > .cp")];
  cards.forEach((c) => (c.style.minHeight = ""));
  requestAnimationFrame(() => {
    const tallest = Math.max(...cards.map((c) => c.offsetHeight));
    cards.forEach((c) => (c.style.minHeight = `${tallest}px`));
  });
  $("cardBtn").focus({ preventScroll: true });
}

function closeSend() {
  sendSheet.hidden = true;
}

function renderSend() {
  const s = ui.shown;
  const days = PICKS.filter((p) => $(p.input).checked).map((p) => p.day);
  const btn = $("cardBtn");
  btn.textContent = days.length ? `カードで送る（${days.length}枚）` : "送る日を選んでね";
  btn.classList.toggle("is-oqrn", Boolean(days.length)); // おくるんのマークは、送れるときだけ
  btn.classList.toggle("is-disabled", !days.length);
  btn.setAttribute("aria-disabled", String(!days.length));
  btn.href = s && days.length && window.OQRN ? window.OQRN.cardUrl(cardParams(s.place, s.data, new Date(), days)) : "#";
}

$("openSend").addEventListener("click", openSend);
PICKS.forEach((p) => $(p.input).addEventListener("change", renderSend));
$("cardBtn").addEventListener("click", (e) => {
  if ($("cardBtn").getAttribute("aria-disabled") === "true") return e.preventDefault();
  renderSend(); // 開いたままの時刻が変わっていても、押したときの中身で
  setTimeout(closeSend, 300);
});
$("sendCancel").addEventListener("click", closeSend);
sendSheet.addEventListener("click", (e) => {
  if (e.target === sendSheet) closeSend();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sendSheet.hidden) closeSend();
});

// ---- 見たい日（ほかのツールから開いたとき） ----
const targetOf = (place) => (place && place.id === "visit" && ui.visit ? ui.visit.target : null);
const targetKey = (place, t) => `${place.lat},${place.lon},${t.date}`;

// 明日より先の日：16日ぶんの予報を聞く（端末には覚えない。開いているあいだだけ）
async function loadTargetDay(place, t) {
  const key = targetKey(place, t);
  if (ui.extending === key) return;
  ui.extending = key;
  try {
    const data = parseForecast(await getJson(forecastUrl(place.lat, place.lon, FORECAST_MAX_DAYS)), new Date(), 24 * FORECAST_MAX_DAYS);
    if (!data) return;
    ui.extended = { key, data };
    const s = ui.shown;
    if (s && s.place.id === "visit" && targetKey(s.place, t) === key) render(s.place, s.data, s.at, s.note);
  } catch {
    // 読めないときは、案内のまま
  } finally {
    ui.extending = "";
  }
}

function targetNoteHtml(t, n) {
  const when = `${dayLabel(t.date)}${t.hour === null ? "" : ` ${t.hour}時ごろ`}`;
  const text = n < 0
    ? `${when}は、もう過ぎています。`
    : n >= FORECAST_MAX_DAYS
      ? `${when}の天気は、${FORECAST_MAX_DAYS}日前ごろから見られます。近くなったら、もう一度開いてね。`
      : `${when}の天気を読みこんでいます…`;
  return `<section class="ls-panel day target-day"><h2 class="day-title">📅 予定の日 <small>${esc(dayLabel(t.date))}</small></h2><p class="ls-hint">${esc(text)}</p></section>`;
}

function dayHtml(data, index, now, hour, target = null) {
  const rows = dayRows(data, index, now);
  const key = addDays(localYmd(now, data.offset), index);
  const info = dayInfo(data, index, now);
  const title = index === 0 ? "今日" : index === 1 ? "明日" : "📅 予定の日";
  const th = target ? target.hour : null;
  const badge = !target ? "" : index > 1 ? (th === null ? "" : `<span class="target-badge">${th}時ごろ</span>`) : `<span class="target-badge">📅 予定${th === null ? "" : `・${th}時`}</span>`;
  if (!rows.length) {
    return `<section class="ls-panel day"><h2 class="day-title">${title} <small>${esc(dayLabel(key))}</small>${badge}</h2><p class="ls-hint">この日の情報がまだありません。</p></section>`;
  }
  const w = weatherOf(info?.code, 1);
  const summary = daySummary(rows, 4, "1日を通して 通常", "\n") || "気圧の情報がありません";
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const cells = Array.from({ length: 24 }, (_, h) => {
    const r = byHour.get(h);
    const lv = r && r.level !== null ? LEVELS[r.level] : null;
    const past = index === 0 && h < hour;
    const nowMark = index === 0 && h === hour;
    const title = `${h}時 ${lv ? lv.label : "—"}${r && r.change !== null ? `（3時間で ${r.change > 0 ? "+" : ""}${r.change.toFixed(1)} hPa）` : ""}`;
    return `<span class="cell${past ? " is-past" : ""}${nowMark ? " is-now" : ""}${th === h ? " is-target" : ""}" style="--c:${lv ? lv.color : "transparent"}" title="${esc(title)}"></span>`;
  }).join("");
  const hours = rows
    .map((r) => {
      const ww = weatherOf(r.code, r.day);
      const lv = r.level === null ? null : LEVELS[r.level];
      const cls = (index === 0 && r.hour < hour ? " is-past" : index === 0 && r.hour === hour ? " is-now" : "") + (th === r.hour ? " is-target" : "");
      return `<li class="hour${cls}"><span class="h">${index === 0 && r.hour === hour ? "いま" : `${r.hour}時`}</span><span class="e" aria-hidden="true">${esc(ww.emoji)}</span><span class="t">${r.temp === null ? "—" : esc(Math.round(r.temp))}°</span><span class="p" style="--c:${lv ? lv.color : "transparent"}">${r.pop === null ? "" : `${esc(r.pop)}%`}</span><span class="sr">${esc(ww.label)}・気圧 ${lv ? esc(lv.label) : "—"}</span></li>`;
    })
    .join("");
  return `
  <section class="ls-panel day${index > 1 ? " target-day" : ""}" aria-label="${title}">
    <div class="day-head">
      <h2 class="day-title">${title} <small>${esc(dayLabel(key))}</small>${badge}</h2>
      <p class="day-weather"><span aria-hidden="true">${esc(w.emoji)}</span> <span class="ls-nowrap">${esc(w.label)}</span> <b class="max">${esc(deg(info?.max))}</b>/<b class="min">${esc(deg(info?.min))}</b>${info?.pop === null || info?.pop === undefined ? "" : ` <span class="pop">☔${esc(Math.round(info.pop))}%</span>`}</p>
    </div>
    <p class="band-label">気圧の変化の目安</p>
    <div class="band" role="img" aria-label="${esc(`気圧の変化の目安：${summary.replace(/\n/g, "、")}`)}">${cells}</div>
    <div class="axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24時</span></div>
    <p class="summary">${esc(summary)}</p>
    <ol class="hours" aria-label="1時間ごとの天気">${hours}</ol>
  </section>`;
}

function renderLegend() {
  document.querySelector(".legend").innerHTML = LEVELS.map((l) => `<li><span class="dot" style="--c:${l.color}"></span>${esc(l.label)}</li>`).join("");
}

// ---- はじめての人に（1回だけ） ----
function tip() {
  window.LineShareUI?.firstTip?.(
    "soraqru",
    ["色の帯は、気圧の変化の目安（青＝通常 → 黄・橙 → 赤＝警戒）", "上の丸いボタンで、実家・職場などの地点を切りかえられます", "「カードで送る」で、今日・明日のまとめを渡せます"],
    $("days")
  );
}

// ---- 時間がたったら ----
// 時刻が変わったら描きなおす（いまの印・過ぎた時間）。1時間たっていたら聞きなおす
let lastHour = new Date().getHours();
setInterval(() => {
  const h = new Date().getHours();
  if (h === lastHour) return;
  lastHour = h;
  if (document.visibilityState === "visible") refresh();
}, 30 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
window.addEventListener("online", () => refresh());
function refresh() {
  const s = ui.shown;
  if (!s) return show();
  const hit = cached(state, s.place.lat, s.place.lon);
  if (!hit || !hit.fresh) return show();
  render(s.place, hit.data, hit.at, "");
}

// 天気の知らせボットの案内は、確かめがすむまで ?preview=notify のときだけ出す
// ---- くらぶボット（確かめ中）：たたみ欄は ?preview=notify か、もうつないでいる人だけに出す ----
const botLink = window.QloveBotLink || null;
const bot = { line: "" }; // ボットの LINE の ID（@…。ping で聞く。端末には残さない）
if (botLink && (new URLSearchParams(location.search).get("preview") === "notify" || botLink.get())) $("notifyFold").hidden = false;

async function pingBot(url) {
  const res = await botLink.ping(url);
  bot.line = res.ok && typeof res.line === "string" && /^@[0-9a-z._-]{2,40}$/i.test(res.line) ? res.line : "";
  return res;
}

function renderBot(statusText) {
  if (!botLink) return;
  const url = botLink.get();
  $("botUrl").value = url;
  $("botClear").hidden = !url;
  if (statusText !== undefined) $("botStatus").textContent = statusText;
  renderNotifyBtn();
}

// 見ている地点を足す文を入れて、ボットのトークを開く（送るのは本人。ボットは送った人の役割で決める）
function renderNotifyBtn() {
  const s = ui.shown;
  const btn = $("notifyBtn");
  btn.hidden = !(botLink && botLink.get() && bot.line && s && Number.isFinite(s.place.lat));
  if (btn.hidden) return;
  const text = `📍 地点を足す ${s.place.lat.toFixed(2)},${s.place.lon.toFixed(2)} ${cleanName(s.place.name === "現在地" ? "" : s.place.name)}`.trim();
  btn.href = `https://line.me/R/oaMessage/${encodeURIComponent(bot.line)}/?${encodeURIComponent(text)}`;
}

if (botLink) {
  $("botSave").addEventListener("click", async () => {
    const saved = botLink.set($("botUrl").value);
    if (!saved.ok) return renderBot(saved.error === "url" ? "GAS の …/exec の URL を入れてね（?key= のない ② の URL）" : "この端末に残せませんでした");
    renderBot("確かめています…");
    const res = await pingBot(saved.url);
    renderBot(res.ok ? `✅ ${res.bot}（版 ${res.version}）とつなぎました` : "つながりませんでした。URL と、ボットのデプロイ（アクセスできるユーザー：全員）を確かめてね");
  });
  $("botClear").addEventListener("click", () => {
    botLink.clear();
    bot.line = "";
    renderBot("つなぐのをやめました");
  });
  if (botLink.get()) pingBot().then((res) => renderBot(res.ok ? `✅ ${res.bot}（版 ${res.version}）とつないでいます` : "いまは、くらぶボットにつながりません"));
  renderBot();
}

renderLegend();
renderEmojiPick();
show();
window.addEventListener("load", tip);
