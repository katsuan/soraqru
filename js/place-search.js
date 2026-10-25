// 場所の名前で探す（ほかのツールから ?q= で開いたとき）。国土地理院の住所さがし → Open-Meteo の地名さがし の順。
// 国土地理院は住所・施設の名前（「沖縄美ら海水族館」「国際通り」「岡山県倉敷市林」）に強く、Open-Meteo は市や町の名前に強い。
// 国土地理院の結果は、名前がぴったり合うもの（都道府県を外しても合うもの）だけ使う（「豊田スタジアム」で「音更町豊田」をひろわないように）。
// 読まれるところ：app.js（テストは test/soraqru.test.mjs）
import { validLatLon } from "./meteo.js?v=202610260600";

export const GSI_SEARCH_API = "https://msearch.gsi.go.jp/address-search/AddressSearch";

// 国土地理院の住所さがしの URL（40字まで）
export const gsiSearchUrl = (text) => `${GSI_SEARCH_API}?${new URLSearchParams({ q: String(text || "").trim().slice(0, 40) })}`;

// はじめの都道府県の名前をはずす
const stripPref = (s) => String(s).replace(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/, "");

/** 国土地理院の返事から、名前がぴったり合うものを1つ。{ name, lat, lon }（0.01 度に丸める）か null */
export function pickGsi(json, text) {
  const q = String(text || "").trim();
  if (!q || !Array.isArray(json)) return null;
  for (const r of json) {
    const title = r && r.properties && typeof r.properties.title === "string" ? r.properties.title.trim() : "";
    const c = r && r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : [];
    if (!title || (title !== q && stripPref(title) !== q && title !== stripPref(q) && stripPref(title) !== stripPref(q))) continue;
    const ll = validLatLon(c[1], c[0]);
    if (ll) return { name: q, ...ll };
  }
  return null;
}
