// そらくる（SoraQru）：URL の受け渡し（送ったカードから開くリンク・ほかのツールから開いたときに読む ?at= ?q= ?date= ?hour= ?from=）。画面には触らない
// 読まれるところ：app.js・js/card.js（テストは test/soraqru.test.mjs）
import { parseTarget, validLatLon } from "./meteo.js?v=202610291807";
import { cleanName } from "./store.js?v=202610291807";

export const PAGE_URL = "https://katsuan.github.io/soraqru/";

// 開いたツールの名前（?from=）。知らない名前は使わない
export const FROM_TOOLS = { yuqsaki: "ゆくさき", saqsen: "さくせん盤", qlovebot: "くらぶボット", kazoq: "KazoQ" };

/** 送ったカードのボタンで開く URL。地名で探した地点だけ場所を入れる（現在地・いまの場所から足した地点は入れない） */
export function openUrl(place) {
  if (!place || place.src !== "search") return PAGE_URL;
  const q = new URLSearchParams({ at: `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`, name: place.name });
  return `${PAGE_URL}?${String(q).replace(/\+/g, "%20")}`;
}

/**
 * 開いたアドレスの ? のあと（location.search）から、見せる地点を読む。なければ null。形を確かめて読む
 * - ?at=35.17,136.88&name=名古屋（送ってもらったカードのボタン）
 * - ほかのツール（ゆくさき・さくせん盤など）からは、場所の名前でも開ける（?q=那覇&date=2026-11-01&hour=13）
 * - date・hour は「見たい日」（target）。今日・明日ならその札に印、それより先（16日先まで）はその日の天気を一番上に
 */
export function readVisit(search) {
  const q = new URLSearchParams(search);
  const target = parseTarget(q.get("date"), q.get("hour"));
  const at = String(q.get("at") || "").split(",");
  const ll = at.length === 2 ? validLatLon(at[0], at[1]) : null;
  const name = cleanName(q.get("name"));
  const from = Object.prototype.hasOwnProperty.call(FROM_TOOLS, q.get("from")) ? FROM_TOOLS[q.get("from")] : "";
  if (ll) return { id: "visit", name: name || "送ってもらった地点", emoji: "📍", ...ll, src: "search", target, from };
  const query = cleanName(q.get("q"), 40);
  // alt：見つからなかったときの代わりの名前（ゆくさきなら、しおりの名前のはじめのことば）
  if (query) return { id: "visit", name: name || cleanName(query), emoji: "📍", query, alt: cleanName(q.get("alt"), 40), lat: null, lon: null, src: "search", target, from };
  return null;
}
