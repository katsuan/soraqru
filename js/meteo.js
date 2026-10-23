// そらくる（SoraQru）：Open-Meteo の返事の読みこみと、気圧の変化の目安。画面には触らない（テストで呼ぶ）
//
// 目安の決め方は KazoQ の予備（q-kazoq/01_27_ZUTOOL_GATEWAY_METEO.js）・SQriptable の気圧カードと同じ：
// 3時間でどれだけ変わるか（上がっても下がっても）1 hPa 未満＝通常・2 未満＝やや注意・3 未満＝注意・それ以上＝警戒。
// 医療の予測ではないので、画面では「気圧の変化の目安」と呼ぶ。

export const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
export const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";

// 段階（0〜3）。色は SQriptable の気圧カードと同じ
export const LEVELS = [
  { label: "通常", color: "#7FA7D9" },
  { label: "やや注意", color: "#E8B931" },
  { label: "注意", color: "#F08A24" },
  { label: "警戒", color: "#E5534B" }
];

const HOURS_KEEP = 72; // 今日・明日・あさって（電波がないまま日をまたいでも、今日・明日が残る）

/** 3時間の変わり方（hPa）→ 段階 0〜3。数でないときは null */
export function levelOf(change) {
  if (change === null || change === undefined || change === "") return null;
  const value = Math.abs(Number(change));
  if (!Number.isFinite(value)) return null;
  if (value < 1) return 0;
  if (value < 2) return 1;
  return value < 3 ? 2 : 3;
}

const round1 = (n) => Math.round(n * 10) / 10;
const finite = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 緯度・経度は 0.01 度（1km くらい）に丸める。覚えるとき・聞くときも同じ丸め方
export const roundCoord = (n) => Math.round(Number(n) * 100) / 100;
export function validLatLon(lat, lon) {
  const a = finite(lat);
  const b = finite(lon);
  return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: roundCoord(a), lon: roundCoord(b) } : null;
}

export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: roundCoord(lat).toFixed(2),
    longitude: roundCoord(lon).toFixed(2),
    hourly: "pressure_msl,temperature_2m,weather_code,precipitation_probability,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    // 0時の「3時間の変わり方」に前の日の夜が要る
    past_days: "1",
    forecast_days: "3"
  });
  return `${FORECAST_API}?${q}`;
}

/**
 * Open-Meteo の返事 → そらくるの形。読めないとき（壊れた・欠けた返事）は null
 *   { offset（その地点の UTC からのずれ・秒）, hours: [{ t, hpa, temp, code, pop, day, level, change }], days: [{ date, code, max, min, pop }] }
 * hours は今日の0時から 72 時間まで。level は3時間前（時刻で探す）とくらべた段階（どちらかの気圧がない時間は null）
 */
export function parseForecast(json, now = new Date()) {
  if (!json || typeof json !== "object") return null;
  const h = json.hourly;
  if (!h || typeof h !== "object" || !Array.isArray(h.time) || !Array.isArray(h.pressure_msl)) return null;
  const offset = finite(json.utc_offset_seconds) ?? 0;
  if (Math.abs(offset) > 14 * 3600) return null;
  const today = localYmd(now, offset);
  const col = (name) => (Array.isArray(h[name]) ? h[name] : []);
  const hpaAt = new Map(h.time.map((t, i) => [t, finite(h.pressure_msl[i])]));
  const hours = [];
  h.time.forEach((t, i) => {
    if (typeof t !== "string" || !TIME.test(t) || t.slice(0, 10) < today || hours.length >= HOURS_KEEP) return;
    const hpa = hpaAt.get(t) ?? null;
    const before = hpaAt.get(shiftHours(t, -3)) ?? null;
    const change = hpa !== null && before !== null ? round1(hpa - before) : null;
    hours.push({
      t,
      hpa: hpa === null ? null : round1(hpa),
      temp: finite(col("temperature_2m")[i]) === null ? null : round1(finite(col("temperature_2m")[i])),
      code: finite(col("weather_code")[i]),
      pop: finite(col("precipitation_probability")[i]),
      day: finite(col("is_day")[i]) === 0 ? 0 : 1,
      change,
      level: levelOf(change)
    });
  });
  // 気圧が1つもないものは使えない
  if (!hours.some((r) => r.hpa !== null)) return null;
  return { offset, hours, days: parseDays(json.daily, hours) };
}

// "2026-10-23T01:00" の n 時間あと（その地点の時刻のまま。夏時間のずれは見ない）
function shiftHours(t, n) {
  const d = new Date(`${t}:00Z`);
  d.setUTCHours(d.getUTCHours() + n);
  return d.toISOString().slice(0, 16);
}

// 日ごとの天気。daily がない・欠けているときは、1時間ごとの値から作る
function parseDays(daily, hours) {
  const dates = [...new Set(hours.map((r) => r.t.slice(0, 10)))];
  const d = daily && typeof daily === "object" && Array.isArray(daily.time) ? daily : { time: [] };
  const col = (name) => (Array.isArray(d[name]) ? d[name] : []);
  return dates.map((date) => {
    const i = d.time.indexOf(date);
    const rows = hours.filter((r) => r.t.startsWith(date));
    const temps = rows.map((r) => r.temp).filter((v) => v !== null);
    const pops = rows.map((r) => r.pop).filter((v) => v !== null);
    const pick = (name, fallback) => (i >= 0 && finite(col(name)[i]) !== null ? finite(col(name)[i]) : fallback);
    return {
      date,
      code: pick("weather_code", worstCode(rows.filter((r) => r.day).map((r) => r.code))),
      max: pick("temperature_2m_max", temps.length ? Math.max(...temps) : null),
      min: pick("temperature_2m_min", temps.length ? Math.min(...temps) : null),
      pop: pick("precipitation_probability_max", pops.length ? Math.max(...pops) : null)
    };
  });
}

// いちばん天気のわるい番号（WMO の番号は大きいほど荒れる）
function worstCode(codes) {
  const list = codes.filter((c) => c !== null);
  return list.length ? Math.max(...list) : null;
}

/** 端末に覚えた中身を読みなおす（形がちがえば null）。parseForecast が作った形だけを通す */
export function cleanForecast(v) {
  if (!v || typeof v !== "object" || !Array.isArray(v.hours) || !Array.isArray(v.days)) return null;
  const offset = finite(v.offset);
  if (offset === null || Math.abs(offset) > 14 * 3600) return null;
  const num = (x) => finite(x);
  const hours = v.hours
    .slice(0, HOURS_KEEP)
    .filter((r) => r && typeof r === "object" && typeof r.t === "string" && TIME.test(r.t))
    .map((r) => ({ t: r.t, hpa: num(r.hpa), temp: num(r.temp), code: num(r.code), pop: num(r.pop), day: r.day === 0 ? 0 : 1, change: num(r.change), level: levelOf(num(r.change)) }));
  if (!hours.some((r) => r.hpa !== null)) return null;
  const days = v.days
    .slice(0, 4)
    .filter((d) => d && typeof d === "object" && typeof d.date === "string" && DATE.test(d.date))
    .map((d) => ({ date: d.date, code: num(d.code), max: num(d.max), min: num(d.min), pop: num(d.pop) }));
  return { offset, hours, days };
}

/** その地点の今の日付（"YYYY-MM-DD"）と時刻（0〜23） */
export function localYmd(now, offset) {
  return new Date(now.getTime() + offset * 1000).toISOString().slice(0, 10);
}
export function localHour(now, offset) {
  return new Date(now.getTime() + offset * 1000).getUTCHours();
}
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
/** "2026-10-23" → "10/23（金）" */
export function dayLabel(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`;
}

/** 今日（0）・明日（1）の1時間ごと。その日がなければ [] */
export function dayRows(data, index, now = new Date()) {
  if (!data) return [];
  const key = addDays(localYmd(now, data.offset), index);
  return data.hours.filter((r) => r.t.startsWith(key)).map((r) => ({ ...r, hour: Number(r.t.slice(11, 13)) }));
}
export function dayInfo(data, index, now = new Date()) {
  if (!data) return null;
  const key = addDays(localYmd(now, data.offset), index);
  return data.days.find((d) => d.date === key) || null;
}

/**
 * やや注意より上の時間をまとめる：[{ from, to（その時間の終わり。15時台までなら 16）, level（いちばん強い段階）, dir（"down"・"up"・""） }]
 */
export function alertRanges(rows) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (r.level !== null && r.level >= 1) {
      if (cur && r.hour === cur.to) {
        cur.to = r.hour + 1;
        cur.level = Math.max(cur.level, r.level);
        cur.sum += r.change || 0;
      } else {
        cur = { from: r.hour, to: r.hour + 1, level: r.level, sum: r.change || 0 };
        out.push(cur);
      }
    } else {
      cur = null;
    }
  }
  return out.map(({ sum, ...x }) => ({ ...x, dir: sum < 0 ? "down" : sum > 0 ? "up" : "" }));
}

/** 「15〜18時 注意（下がる）」 */
export function rangeText(r) {
  const dir = r.dir === "down" ? "（下がる）" : r.dir === "up" ? "（上がる）" : "";
  return `${r.from}〜${r.to}時 ${LEVELS[r.level].label}${dir}`;
}

/** その日のまとめ（1行）。気圧がない日は ""。calm は、ずっと通常のときの言い方 */
export function daySummary(rows, max = 4, calm = "1日を通して 通常") {
  if (!rows.some((r) => r.level !== null)) return "";
  const ranges = alertRanges(rows);
  if (!ranges.length) return calm;
  const shown = ranges.slice(0, max).map(rangeText);
  return shown.join("、") + (ranges.length > max ? ` ほか${ranges.length - max}か所` : "");
}

/** WMO の天気の番号 → { emoji, label }。day=0 は夜 */
export function weatherOf(code, day = 1) {
  const c = finite(code);
  if (c === null) return { emoji: "—", label: "—" };
  if (c === 0) return day ? { emoji: "☀️", label: "快晴" } : { emoji: "🌙", label: "快晴" };
  if (c === 1) return day ? { emoji: "🌤️", label: "晴れ" } : { emoji: "🌙", label: "晴れ" };
  if (c === 2) return { emoji: day ? "⛅" : "☁️", label: "晴れときどきくもり" };
  if (c === 3) return { emoji: "☁️", label: "くもり" };
  if (c === 45 || c === 48) return { emoji: "🌫️", label: "きり" };
  if (c >= 51 && c <= 57) return { emoji: day ? "🌦️" : "🌧️", label: "きりさめ" };
  if (c >= 61 && c <= 67) return { emoji: "🌧️", label: c >= 65 ? "強い雨" : "雨" };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { emoji: "🌨️", label: "雪" };
  if (c >= 80 && c <= 82) return { emoji: day ? "🌦️" : "🌧️", label: "にわか雨" };
  if (c >= 95) return { emoji: "⛈️", label: "雷雨" };
  return { emoji: "☁️", label: "くもり" };
}

/** 地名さがしの返事 → [{ name, sub, lat, lon }]（日本を先、人の多い順。同じ場所は1つ） */
export function parseGeocode(...jsons) {
  const seen = new Set();
  const list = [];
  for (const json of jsons) {
    const results = json && typeof json === "object" && Array.isArray(json.results) ? json.results : [];
    for (const r of results) {
      if (!r || typeof r !== "object") continue;
      const ll = validLatLon(r.latitude, r.longitude);
      const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
      if (!ll || !name) continue;
      const key = `${ll.lat},${ll.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = [r.admin1, r.country_code === "JP" ? "" : r.country].filter((x) => typeof x === "string" && x).join("・").slice(0, 40);
      list.push({ name, sub, ...ll, jp: r.country_code === "JP", pop: finite(r.population) || 0 });
    }
  }
  return list
    .sort((a, b) => b.jp - a.jp || b.pop - a.pop)
    .slice(0, 6)
    .map(({ jp, pop, ...x }) => x);
}

/** 地名を探す URL（日本語の地名は「名古屋」と「名古屋市」の両方で探すと当たりやすい。SQriptable と同じ） */
export function geocodeUrls(text) {
  const name = String(text || "").trim().slice(0, 40);
  if (!name) return [];
  const names = /[市区町村都道府県]$/.test(name) || !/[぀-ヿ一-鿿]/.test(name) ? [name] : [name, `${name}市`];
  return names.map((n) => `${GEOCODE_API}?${new URLSearchParams({ name: n, count: "8", language: "ja", format: "json" })}`);
}
