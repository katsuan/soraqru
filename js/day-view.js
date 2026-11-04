// そらくる（SoraQru）：1日ぶん（今日・明日・見たい日）の札の HTML。画面には触らない（文字を返すだけ。テストで呼ぶ）
//   札の中身：見出し（今日・明日・予定の日と日付、見たい日の印）→ 天気と最高・最低・降水確率 → 日の出・日の入り
//            → 気圧の帯（1時間ずつ 24 こ）と目盛り → 注意の時間帯のまとめ → 1時間ごとの札（あいだに日の出・日の入りの札）
// 読まれるところ：app.js（テストは test/soraqru.test.mjs）
import { LEVELS, addDays, dayInfo, dayLabel, dayRows, daySummary, deg, localHour, localYmd, weatherOf, FORECAST_MAX_DAYS } from "./meteo.js?v=202611012034";

/** 文字を HTML に入れられる形にする（& < > " ' を置きかえる） */
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Q キットの線アイコン（HTML の文字で。名前は Q キットの kit.html の「線アイコン」） */
export const iconHtml = (name) => `<span class="ls-icon" data-icon="${name}" aria-hidden="true"></span>`;

const TARGET_TITLE = `${iconHtml("calendar")}予定の日`;

// 見たい日の印（今日・明日の札は「予定・15時」、明日より先の札は時刻だけ）
function targetBadgeHtml(target, index) {
  if (!target) return "";
  const th = target.hour;
  if (index > 1) return th === null ? "" : `<span class="target-badge">${th}時ごろ</span>`;
  return `<span class="target-badge">${iconHtml("calendar")}予定${th === null ? "" : `・${th}時`}</span>`;
}

// 気圧の帯：1時間ずつ 24 こ（色＝段階。今日の過ぎた時間はうすく、いまに枠、見たい時刻に印）
function bandCellsHtml(rows, index, hour, th) {
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, h) => {
    const r = byHour.get(h);
    const lv = r && r.level !== null ? LEVELS[r.level] : null;
    const past = index === 0 && h < hour;
    const nowMark = index === 0 && h === hour;
    const title = `${h}時 ${lv ? lv.label : "—"}${r && r.drop !== null && r.drop > 0 ? `（6時間で ${r.drop.toFixed(1)} hPa 下がる）` : ""}`;
    return `<span class="cell${past ? " is-past" : ""}${nowMark ? " is-now" : ""}${th === h ? " is-target" : ""}" style="--c:${lv ? lv.color : "transparent"}" title="${esc(title)}"></span>`;
  }).join("");
}

/**
 * 日の出・日の入りの札：[{ hour, html }]（わからないものは入れない）。今日の、もう過ぎたものはうすく。
 * nowMin は今日のいまの時刻（0時からの分）。今日でなければ -1
 */
function sunCards(info, index, nowMin) {
  return [["sunrise", "日の出", info?.sunrise], ["sunset", "日の入り", info?.sunset]]
    .filter(([, , time]) => time)
    .map(([icon, label, time]) => {
      const [hh, mm] = time.split(":").map(Number);
      const past = index === 0 && hh * 60 + mm < nowMin ? " is-past" : "";
      return { hour: hh, html: `<li class="hour sun-mark${past}"><span class="h">${label}</span>${iconHtml(icon)}<span class="t">${esc(time)}</span></li>` };
    });
}

// 1時間ごとの札（天気・気温・降水確率・気圧の色）。日の出・日の入りの札は、その時間の札のすぐあとに
function hoursHtml(rows, index, hour, th, suns) {
  return rows
    .map((r) => {
      const ww = weatherOf(r.code, r.day);
      const lv = r.level === null ? null : LEVELS[r.level];
      const cls = (index === 0 && r.hour < hour ? " is-past" : index === 0 && r.hour === hour ? " is-now" : "") + (th === r.hour ? " is-target" : "");
      const card = `<li class="hour${cls}"><span class="h">${index === 0 && r.hour === hour ? "いま" : `${r.hour}時`}</span><span class="e" aria-hidden="true">${esc(ww.emoji)}</span><span class="t">${r.temp === null ? "—" : esc(Math.round(r.temp))}°</span><span class="p" style="--c:${lv ? lv.color : "transparent"}">${r.pop === null ? "" : `${esc(r.pop)}%`}</span><span class="sr">${esc(ww.label)}・気圧 ${lv ? esc(lv.label) : "—"}</span></li>`;
      return card + suns.filter((c) => c.hour === r.hour).map((c) => c.html).join("");
    })
    .join("");
}

/** 日の出・日の入りの行（天気の下。わからない日は出さない） */
export function sunHtml(info) {
  const part = (icon, label, time) => (time ? `<span class="ls-nowrap">${iconHtml(icon)}${label} ${esc(time)}</span>` : "");
  const parts = [part("sunrise", "日の出", info?.sunrise), part("sunset", "日の入り", info?.sunset)].filter(Boolean);
  return parts.length ? `<p class="day-sun">${parts.join(" ")}</p>` : "";
}

/**
 * 1日ぶんの札の HTML。index はきょうから何日先か（0 今日・1 明日・2 から先は見たい日）、hour はその地点のいまの時（0〜23）、
 * target は見たい日 { date, hour }（その日の札のときだけ）
 */
export function dayHtml(data, index, now, hour, target = null) {
  const rows = dayRows(data, index, now);
  const key = addDays(localYmd(now, data.offset), index);
  const info = dayInfo(data, index, now);
  const title = index === 0 ? "今日" : index === 1 ? "明日" : TARGET_TITLE;
  const th = target ? target.hour : null;
  const head = `<h2 class="day-title">${title} <small>${esc(dayLabel(key))}</small>${targetBadgeHtml(target, index)}</h2>`;
  if (!rows.length) return `<section class="ls-panel day">${head}<p class="ls-hint">この日の情報がまだありません。</p></section>`;
  const w = weatherOf(info?.code, 1);
  const summary = daySummary(rows, 4, "1日を通して 通常", "\n") || "気圧の情報がありません";
  // 今日のいまの時刻（0時からの分）。日の出・日の入りの札を、過ぎたらうすくする
  const nowMin = index === 0 ? localHour(now, data.offset) * 60 + new Date(now.getTime() + data.offset * 1000).getUTCMinutes() : -1;
  const pop = info?.pop === null || info?.pop === undefined ? "" : ` <span class="pop">☔${esc(Math.round(info.pop))}%</span>`;
  return `
  <section class="ls-panel day${index > 1 ? " target-day" : ""}" aria-label="${title}">
    <div class="day-head">
      ${head}
      <p class="day-weather"><span aria-hidden="true">${esc(w.emoji)}</span> <span class="ls-nowrap">${esc(w.label)}</span> <b class="max">${esc(deg(info?.max))}</b>/<b class="min">${esc(deg(info?.min))}</b>${pop}</p>
      ${sunHtml(info)}
    </div>
    <p class="band-label">気圧の変化の目安</p>
    <div class="band" role="img" aria-label="${esc(`気圧の変化の目安：${summary.replace(/\n/g, "、")}`)}">${bandCellsHtml(rows, index, hour, th)}</div>
    <div class="axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24時</span></div>
    <p class="summary">${esc(summary)}</p>
    <ol class="hours" aria-label="1時間ごとの天気">${hoursHtml(rows, index, hour, th, sunCards(info, index, nowMin))}</ol>
  </section>`;
}

/** 見たい日の案内の札（過ぎた・まだ先・読みこみ中）。n はきょうから何日先か */
export function targetNoteHtml(t, n) {
  const when = `${dayLabel(t.date)}${t.hour === null ? "" : ` ${t.hour}時ごろ`}`;
  const text = n < 0
    ? `${when}は、もう過ぎています。`
    : n >= FORECAST_MAX_DAYS
      ? `${when}の天気は、${FORECAST_MAX_DAYS}日前ごろから見られます。近くなったら、もう一度開いてね。`
      : `${when}の天気を読みこんでいます…`;
  return `<section class="ls-panel day target-day"><h2 class="day-title">${TARGET_TITLE} <small>${esc(dayLabel(t.date))}</small></h2><p class="ls-hint">${esc(text)}</p></section>`;
}

/** 気圧の色の見本（たたみ欄「気圧の変化の目安について」の中） */
export function legendHtml() {
  return LEVELS.map((l) => `<li><span class="dot" style="--c:${l.color}"></span>${esc(l.label)}</li>`).join("");
}
