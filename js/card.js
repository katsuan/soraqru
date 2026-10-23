// そらくる（SoraQru）：おくるんのお知らせカード（OQRN.cardUrl）に渡す中身。画面には触らない（テストで呼ぶ）
import { LEVELS, dayInfo, dayLabel, dayRows, daySummary, weatherOf, addDays, localYmd } from "./meteo.js?v=202610232249";

export const PAGE_URL = "https://katsuan.github.io/soraqru/";
export const CARD_COLOR = "#3A56D6"; // ロゴの群青
export const CREDIT = "天気データ：Open-Meteo.com（CC BY 4.0）";
const DETAIL_MAX = 300;

const deg = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}°`);

/** 1日ぶんの文（カードと画面で同じ言い方） */
export function dayText(data, index, now = new Date()) {
  const info = dayInfo(data, index, now);
  const rows = dayRows(data, index, now);
  if (!info && !rows.length) return "";
  const key = addDays(localYmd(now, data.offset), index);
  const w = weatherOf(info?.code, 1);
  const pop = info?.pop === null || info?.pop === undefined ? "" : ` ☔${Math.round(info.pop)}%`;
  // トークで読みやすいよう、見出し・天気・気圧の時間帯を、それぞれ1行に
  const head = `【${index ? "明日" : "今日"} ${dayLabel(key)}】\n${w.emoji} ${w.label} ${deg(info?.max)}/${deg(info?.min)}${pop}`;
  // 今日は、これからの時間だけ（過ぎた時間の注意は送らない）
  const from = index ? 0 : localHourOf(now, data);
  const summary = daySummary(from ? rows.filter((r) => r.hour >= from) : rows, 3, from ? "通常" : "1日を通して 通常", "\n・");
  if (!summary) return head;
  const title = `🌀 気圧${from ? `（${from}時から）` : ""}`;
  return /〜/.test(summary) ? `${head}\n${title}\n・${summary}` : `${head}\n${title}：${summary}`;
}

const localHourOf = (now, data) => new Date(now.getTime() + data.offset * 1000).getUTCHours();

/** 送ったカードのボタンで開く URL。地名で探した地点だけ場所を入れる（現在地・いまの場所から足した地点は入れない） */
export function openUrl(place) {
  if (!place || place.src !== "search") return PAGE_URL;
  const q = new URLSearchParams({ at: `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`, name: place.name });
  return `${PAGE_URL}?${String(q).replace(/\+/g, "%20")}`;
}

/** カードの中身（URLSearchParams）。place は { name, lat, lon, src } */
export function cardParams(place, data, now = new Date()) {
  const name = place?.name || "現在地";
  const today = localYmd(now, data.offset);
  const lines = [dayText(data, 0, now), dayText(data, 1, now)].filter(Boolean);
  let detail = lines.join("\n\n");
  const tail = `\n\n気圧は3時間の変わり方から出した目安です。\n${CREDIT}`;
  if ([...detail].length + [...tail].length > DETAIL_MAX) detail = [...detail].slice(0, DETAIL_MAX - [...tail].length - 1).join("") + "…";
  return new URLSearchParams({
    headerTitle: "🌤️ 空のごきげん",
    title: `${name}の今日・明日`,
    date: `${dayLabel(today)}・${dayLabel(addDays(today, 1))}`,
    showDate: "true",
    detail: detail + tail,
    theme: "custom",
    customColor: CARD_COLOR,
    showAction: "true",
    actionLabel: "🌤️ そらくるで見る",
    actionUrl: openUrl(place),
    from: "soraqru"
  });
}

export { LEVELS };
