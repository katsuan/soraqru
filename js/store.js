// そらくる（SoraQru）：この端末に残すもの（localStorage の soraqru:v1）。読むときは形を確かめる
//   places  … 覚えた地点 [{ id, name, emoji, lat, lon, src（"search"＝地名で探した・"gps"＝いまの場所） }]
//   current … 見ている地点（"here"＝現在地、または places の id）
//   here    … 前に取れた現在地（0.01 度に丸めたもの。次に開いたとき、先に前の結果を出すため）と、その地名（name。例：名古屋市中村区。わからなければ無し）
//   cache   … 地点ごとの天気（{ "35.17,136.88": { at（取った時刻 ms）, data } }。1時間ほどは聞きなおさない）
import { cleanForecast, validLatLon } from "./meteo.js?v=202610250955";

export const KEY = "soraqru:v1";
export const MAX_PLACES = 8;
export const MAX_NAME = 12;
export const MAX_CACHE = 10;
export const FRESH_MS = 60 * 60 * 1000; // 1時間
export const KEEP_MS = 3 * 24 * 60 * 60 * 1000; // これより古い天気は捨てる
export const PLACE_EMOJIS = ["📍", "🏠", "🏢", "🏫", "🏡", "👵", "⛰️", "🏖️"];

const ID = /^[a-z0-9]{1,16}$/;

export const blank = () => ({ places: [], current: "here", here: null, cache: {} });

/** 名前：前後の空白をとり、長さに上限（絵文字を半分にしない） */
export function cleanName(v, max = MAX_NAME) {
  return [...String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, max).join("");
}

export function cleanPlace(p) {
  if (!p || typeof p !== "object") return null;
  const ll = validLatLon(p.lat, p.lon);
  const name = cleanName(p.name);
  if (!ll || !name || typeof p.id !== "string" || !ID.test(p.id)) return null;
  return { id: p.id, name, emoji: PLACE_EMOJIS.includes(p.emoji) ? p.emoji : PLACE_EMOJIS[0], ...ll, src: p.src === "gps" ? "gps" : "search" };
}

export const placeKey = (lat, lon) => `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;

/** 中身を確かめて読む。壊れていたら、読めるところだけ */
export function parse(raw, now = Date.now()) {
  const state = blank();
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return state;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return state;
  if (Array.isArray(v.places)) {
    const ids = new Set();
    for (const p of v.places.slice(0, MAX_PLACES)) {
      const place = cleanPlace(p);
      if (place && !ids.has(place.id)) {
        ids.add(place.id);
        state.places.push(place);
      }
    }
  }
  state.current = state.places.some((p) => p.id === v.current) ? v.current : "here";
  if (v.here && typeof v.here === "object") {
    state.here = validLatLon(v.here.lat, v.here.lon);
    const name = state.here && typeof v.here.name === "string" ? cleanName(v.here.name) : "";
    if (name) state.here.name = name;
  }
  if (v.cache && typeof v.cache === "object" && !Array.isArray(v.cache)) {
    for (const [key, entry] of Object.entries(v.cache).slice(0, MAX_CACHE * 2)) {
      if (!/^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/.test(key) || !entry || typeof entry !== "object") continue;
      const at = Number(entry.at);
      if (!Number.isFinite(at) || at > now + 60_000 || now - at > KEEP_MS) continue;
      const data = cleanForecast(entry.data);
      if (data) state.cache[key] = { at, data };
    }
    trimCache(state);
  }
  return state;
}

export function load(storage = globalThis.localStorage, now = Date.now()) {
  try {
    return parse(storage.getItem(KEY), now);
  } catch {
    return blank();
  }
}

/** 残せたら true（プライベートブラウズ・いっぱいのときは false） */
export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function newId(state, rand = Math.random) {
  for (;;) {
    const id = rand().toString(36).slice(2, 10) || "p";
    if (ID.test(id) && !state.places.some((p) => p.id === id)) return id;
  }
}

/** 地点を足す。いっぱいなら null。同じ場所がもうあれば、それを返す */
export function addPlace(state, { name, emoji, lat, lon, src }) {
  const ll = validLatLon(lat, lon);
  if (!ll) return null;
  const same = state.places.find((p) => p.lat === ll.lat && p.lon === ll.lon);
  if (same) return same;
  if (state.places.length >= MAX_PLACES) return null;
  const place = cleanPlace({ id: newId(state), name: cleanName(name) || "地点", emoji, ...ll, src });
  state.places.push(place);
  return place;
}

/** 地点を外す。元に戻すための { place, index } を返す */
export function removePlace(state, id) {
  const index = state.places.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const [place] = state.places.splice(index, 1);
  if (state.current === id) state.current = "here";
  return { place, index };
}

export function restorePlace(state, { place, index }) {
  if (state.places.length >= MAX_PLACES || state.places.some((p) => p.id === place.id)) return;
  state.places.splice(Math.min(index, state.places.length), 0, place);
}

export function cached(state, lat, lon, now = Date.now()) {
  const entry = state.cache[placeKey(lat, lon)];
  if (!entry) return null;
  return { ...entry, fresh: now - entry.at < FRESH_MS };
}

export function putCache(state, lat, lon, data, now = Date.now()) {
  state.cache[placeKey(lat, lon)] = { at: now, data };
  trimCache(state);
}

// 新しいものから MAX_CACHE こだけ残す
function trimCache(state) {
  const keys = Object.keys(state.cache).sort((a, b) => state.cache[b].at - state.cache[a].at);
  for (const key of keys.slice(MAX_CACHE)) delete state.cache[key];
}
