// 9_season.gs：季節の絵文字（Q ツール共通。q-oqrn/shared/season.js をそのまま写したもの。直すときは写しなおす）
// 季節の絵文字（Q ツール共通）。その時期に合う絵文字を、ときどきランダムに出す。
// イベントの時期（ハロウィン・クリスマスなど）は出やすく、当日はもっと出やすい。
//
// ページでも GAS でも同じファイルを使う（GAS には season.gs として写す。中身はこのファイルと同じ）。
//   ページ：<script src="https://katsuan.github.io/line-share/shared/season.js"></script> → window.QSeason
//           tool-share.js を読んでいるツールは、自動で読まれる
//   GAS   ：QSeason.decorate("記録しました") など。日付は日本時間で見る
//
// 使い方
//   QSeason.pick()             … 今の時期の絵文字を1つ（必ず返す）
//   QSeason.maybe()            … 出すときだけ絵文字、出さないときは ""（ふだん 3割・イベント中 6割・当日 9割）
//   QSeason.decorate(text)     … maybe() が出たら文の後ろに「 🎃」を付ける
//   QSeason.events()           … 今かかっているイベント（{ key, name, emojis, peak }）
//   どれも最後に { date, rand } を渡せる（テスト用。date は Date、rand は 0〜1 を返す関数）
var QSeason = (function () {
  "use strict";

  // 月ごとのふだんの絵文字
  var MONTHS = {
    1: ["⛄", "❄️", "🍊", "🎍"],
    2: ["❄️", "⛄", "🍫", "🌼"],
    3: ["🌸", "🌱", "🍡", "🐣"],
    4: ["🌸", "🌷", "🐝", "🌱"],
    5: ["🌿", "🍀", "🎏", "🐛"],
    6: ["☔", "🐌", "🐸", "🌂"],
    7: ["🌻", "🍉", "🌊", "🎐"],
    8: ["🌻", "🍉", "🍧", "🎆"],
    9: ["🌾", "🍇", "🌕", "🎑"],
    10: ["🍁", "🍂", "🍠", "🌰"],
    11: ["🍁", "🍂", "🍄", "🌰"],
    12: ["❄️", "⛄", "🧣", "🎄"],
  };

  // イベント。from・to は「月-日」（年をまたぐものは to が小さくてよい）。peak は当日（なければ to）
  // 年で日が変わるもの（十五夜・母の日・父の日）は dates() で年ごとに決める
  var EVENTS = [
    { key: "newyear", name: "お正月", from: "1-1", to: "1-7", peak: "1-1", emojis: ["🎍", "🎌", "🎉", "🌅"] },
    { key: "setsubun", name: "節分", from: "1-31", to: "2-3", peak: "2-3", emojis: ["👹", "🫘", "🍣"] },
    { key: "valentine", name: "バレンタイン", from: "2-8", to: "2-14", emojis: ["🍫", "💝", "💌"] },
    { key: "hinamatsuri", name: "ひなまつり", from: "2-25", to: "3-3", emojis: ["🎎", "🌸", "🍡"] },
    { key: "whiteday", name: "ホワイトデー", from: "3-12", to: "3-14", emojis: ["🍬", "🍪", "💐"] },
    { key: "hanami", name: "お花見", from: "3-25", to: "4-10", peak: "4-1", emojis: ["🌸", "🍡", "🌸", "🍱"] },
    { key: "kodomo", name: "こどもの日", from: "4-29", to: "5-5", emojis: ["🎏", "🎏", "⚔️"] },
    { key: "mothersday", name: "母の日", days: 5, emojis: ["💐", "🌹", "🎁"], dates: function (y) { return nthSunday(y, 5, 2); } },
    { key: "fathersday", name: "父の日", days: 5, emojis: ["👔", "🍺", "🎁"], dates: function (y) { return nthSunday(y, 6, 3); } },
    { key: "tanabata", name: "七夕", from: "7-1", to: "7-7", emojis: ["🎋", "⭐", "🌌"] },
    { key: "summer", name: "夏休み", from: "7-20", to: "8-31", peak: "8-1", emojis: ["🎆", "🍧", "🏖️", "🍉"] },
    { key: "obon", name: "お盆", from: "8-13", to: "8-16", emojis: ["🏮", "🍆", "🥒"] },
    { key: "tsukimi", name: "お月見", days: 4, emojis: ["🎑", "🌕", "🍡", "🐇"], dates: function (y) { return JUGOYA[y] || null; } },
    { key: "halloween", name: "ハロウィン", from: "10-15", to: "10-31", emojis: ["🎃", "👻", "🦇", "🍬"] },
    { key: "koyo", name: "紅葉", from: "11-10", to: "11-30", peak: "11-23", emojis: ["🍁", "🍁", "🍂"] },
    { key: "christmas", name: "クリスマス", from: "12-15", to: "12-25", emojis: ["🎄", "🎅", "🎁", "⛄"] },
    { key: "omisoka", name: "大みそか", from: "12-29", to: "12-31", emojis: ["🔔", "🍜", "🎍"] },
  ];

  // 十五夜（年で変わる）。足りなくなったら足す
  var JUGOYA = { 2025: "10-6", 2026: "9-25", 2027: "9-15", 2028: "10-3", 2029: "9-22", 2030: "9-12" };

  // 出やすさ
  var RATE = { normal: 0.3, event: 0.6, peak: 0.9 };
  // イベント中に、イベントの絵文字を選ぶ割合（のこりは月のふだんの絵文字）
  var EVENT_SHARE = 0.75;

  function nthSunday(y, month, n) {
    var first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    var day = 1 + ((7 - first) % 7) + (n - 1) * 7;
    return month + "-" + day;
  }

  // 日本時間の年・月・日
  function jst(date) {
    var d = new Date((date ? date.getTime() : Date.now()) + 9 * 3600 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  function md(s) {
    var p = String(s).split("-");
    return Number(p[0]) * 100 + Number(p[1]);
  }

  // その年の何日目かの代わりに、月*100+日で比べる。from > to は年をまたぐ
  function within(n, from, to) {
    return from <= to ? n >= from && n <= to : n >= from || n <= to;
  }

  function minusDays(y, mdStr, days) {
    var p = mdStr.split("-");
    var t = new Date(Date.UTC(y, Number(p[0]) - 1, Number(p[1]) - days));
    return t.getUTCMonth() + 1 + "-" + t.getUTCDate();
  }

  function events(opts) {
    var t = jst(opts && opts.date);
    var n = t.m * 100 + t.d;
    var out = [];
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i];
      var from = e.from;
      var to = e.to;
      var peak = e.peak;
      if (e.dates) {
        var day = e.dates(t.y);
        if (!day) continue;
        from = minusDays(t.y, day, (e.days || 1) - 1);
        to = day;
        peak = day;
      }
      if (within(n, md(from), md(to))) {
        out.push({ key: e.key, name: e.name, emojis: e.emojis.slice(), peak: n === md(peak || to) });
      }
    }
    return out;
  }

  function rnd(opts) {
    return opts && typeof opts.rand === "function" ? opts.rand : Math.random;
  }

  function choose(list, r) {
    return list[Math.min(list.length - 1, Math.floor(r() * list.length))];
  }

  function pick(opts) {
    var r = rnd(opts);
    var t = jst(opts && opts.date);
    var evs = events(opts);
    if (evs.length && r() < EVENT_SHARE) {
      // 当日のイベントがあれば、それを先に
      var peaks = evs.filter(function (e) { return e.peak; });
      var ev = choose(peaks.length ? peaks : evs, r);
      return choose(ev.emojis, r);
    }
    return choose(MONTHS[t.m], r);
  }

  function rate(opts) {
    var evs = events(opts);
    if (evs.some(function (e) { return e.peak; })) return RATE.peak;
    return evs.length ? RATE.event : RATE.normal;
  }

  function maybe(opts) {
    var r = rnd(opts);
    return r() < rate(opts) ? pick(opts) : "";
  }

  function decorate(text, opts) {
    var e = maybe(opts);
    return e ? String(text) + " " + e : String(text);
  }

  return { pick: pick, maybe: maybe, decorate: decorate, events: events, rate: rate, MONTHS: MONTHS, EVENTS: EVENTS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = QSeason;
else if (typeof window !== "undefined") window.QSeason = QSeason;
