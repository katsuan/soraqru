// 現在地の地名（例：名古屋市中村区）を調べる。
// 国土地理院の逆ジオコーダーで市区町村のコードを聞き、data/muni.json（tools/muni.py で作る表）で名前にする。
// 送るのは 0.001 度（100m くらい）に丸めた位置だけ（端末に残す位置は 0.01 度＝1km のまま。地名を調べるときだけ使い、残さない）。
// 1km に丸めた位置で調べると、市のさかいの近くでは、となりの市区町村になることがあるため（例：倉敷市林 → 岡山市南区）。
// 日本の外・海の上・つながらないときは "" を返す（画面は「現在地」のまま）。

const API = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const TIMEOUT_MS = 6000;
let table = null; // data/muni.json（1回だけ読む）

/** 逆ジオコーダーの返事から、市区町村のコードを取り出す（数字だけ。先頭の 0 は外す） */
export function muniCode(json) {
  const cd = json && json.results && json.results.muniCd;
  return typeof cd === "string" && /^\d{4,6}$/.test(cd) ? String(Number(cd)) : "";
}

/** コードを名前に。表にないときは "" */
export function muniName(code, muni) {
  const name = code && muni && Object.prototype.hasOwnProperty.call(muni, code) ? muni[code] : "";
  return typeof name === "string" ? name : "";
}

async function getJson(url, fetchFn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    return res.ok ? await res.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

/** 地名を調べるための位置：0.001 度（100m くらい）に丸める。数でない・範囲の外は null */
export function fineLatLon(lat, lon) {
  const a = lat === null || lat === "" ? NaN : Number(lat);
  const b = lon === null || lon === "" ? NaN : Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: Math.round(a * 1000) / 1000, lon: Math.round(b * 1000) / 1000 };
}

/** 位置から地名を調べる。うまくいかないときは "" */
export async function placeName(lat, lon, fetchFn = globalThis.fetch) {
  const ll = fineLatLon(lat, lon);
  if (!ll || !fetchFn) return "";
  try {
    const q = new URLSearchParams({ lat: ll.lat.toFixed(3), lon: ll.lon.toFixed(3) });
    const [geo, muni] = await Promise.all([
      getJson(`${API}?${q}`, fetchFn),
      table ? Promise.resolve(table) : getJson(new URL("../data/muni.json?v=1", import.meta.url).href, fetchFn),
    ]);
    if (muni && typeof muni === "object") table = muni;
    return muniName(muniCode(geo), table);
  } catch {
    return "";
  }
}
