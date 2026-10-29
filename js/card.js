// そらくる（SoraQru）：おくるんのお知らせカード（OQRN.cardUrl）に渡す中身。画面には触らない（テストで呼ぶ）
// 読まれるところ：app.js（テストは test/soraqru.test.mjs）
import { LEVELS, dayInfo, dayLabel, dayRows, daySummary, deg, weatherOf, addDays, localHour, localYmd } from "./meteo.js?v=202610291710";
import { openUrl } from "./link.js?v=202610291710";

export const CARD_COLOR = "#3A56D6"; // ロゴの群青
export const CREDIT = "天気データ：Open-Meteo.com（CC BY 4.0）";
const DETAIL_MAX = 300;

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
  const from = index ? 0 : localHour(now, data.offset);
  const summary = daySummary(from ? rows.filter((r) => r.hour >= from) : rows, 3, from ? "通常" : "1日を通して 通常", "\n・");
  if (!summary) return head;
  const title = `🌀 気圧${from ? `（${from}時から）` : ""}`;
  return /〜/.test(summary) ? `${head}\n${title}\n・${summary}` : `${head}\n${title}：${summary}`;
}

/** 1日ぶんのカード（index 0＝今日・1＝明日）。place は { name, lat, lon, src } */
export function dayCard(place, data, index, now = new Date()) {
  const name = place?.name || "現在地";
  const key = addDays(localYmd(now, data.offset), index);
  const day = index ? "明日" : "今日";
  let detail = dayText(data, index, now).replace(/^【[^】]*】\n/, "") || "この日の情報がまだありません";
  const tail = `\n\n気圧は3時間の変わり方から出した目安です。\n${CREDIT}`;
  if ([...detail].length + [...tail].length > DETAIL_MAX) detail = [...detail].slice(0, DETAIL_MAX - [...tail].length - 1).join("") + "…";
  return new URLSearchParams({
    headerTitle: `🌤️ ${day}の空のごきげん`,
    title: `${name}の${day}`,
    date: dayLabel(key),
    showDate: "true",
    detail: detail + tail,
    theme: "custom",
    customColor: CARD_COLOR,
    showAction: "true",
    actionLabel: "🌤️ そらくるで見る",
    actionUrl: openUrl(place)
  });
}

/**
 * おくるんのお知らせカードに渡す中身。days は送る日（[0, 1]＝今日と明日の2枚・[0]＝今日だけ・[1]＝明日だけ）。
 * 2枚のときは、2枚目を card= に入れる（おくるんが横に並べて1通で送る）
 */
export function cardParams(place, data, now = new Date(), days = [0, 1]) {
  const list = (days.length ? days : [0, 1]).filter((d) => d === 0 || d === 1);
  const [first, ...rest] = list.map((d) => dayCard(place, data, d, now));
  for (const card of rest) first.append("card", String(card).replace(/\+/g, "%20"));
  first.set("from", "soraqru");
  return first;
}

export { LEVELS };
