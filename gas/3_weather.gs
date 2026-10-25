/**
 * 3_weather.gs：予報を読む・知らせることを決める（シート・LINE には触らない。テストで呼ぶ）
 *
 * 知らせるのは、次のどれかがある日だけ（何もない日は送らない）
 *   ☔ 雨：6〜21時に降水確率 60% 以上の時間がある
 *   🌀 気圧：3時間の変化が「注意」「警戒」の時間がある（そらくるの js/meteo.js と同じ目安。下に写した）
 *   🌡️ 気温：最高気温が前の日より 5℃ 以上ちがう
 * 中身は KazoQ の「場所の天気の知らせ」（q-kazoq/01_43_WEATHER_NOTICE.js）と同じ。
 */

// ---- 気圧の変化の目安（q-soraqru/js/meteo.js の LEVELS・levelOf・alertRanges・rangeText をそのまま写したもの。
//      test/bot.test.mjs で、そらくると同じ答えになるかを確かめる） ----

const SORAQRU_LEVELS_ = [
  { label: '通常', color: '#7FA7D9' },
  { label: 'やや注意', color: '#E8B931' },
  { label: '注意', color: '#F08A24' },
  { label: '警戒', color: '#E5534B' }
];

function soraqruLevelOf_(change) {
  if (change === null || change === undefined || change === '') return null;
  const value = Math.abs(Number(change));
  if (!Number.isFinite(value)) return null;
  if (value < 1) return 0;
  if (value < 2) return 1;
  return value < 3 ? 2 : 3;
}

function soraqruAlertRanges_(rows) {
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
  return out.map(({ sum, ...x }) => ({ ...x, dir: sum < 0 ? 'down' : sum > 0 ? 'up' : '' }));
}

function soraqruRangeText_(r) {
  const dir = r.dir === 'down' ? '（下がる）' : r.dir === 'up' ? '（上がる）' : '';
  return `${r.from}〜${r.to}時 ${SORAQRU_LEVELS_[r.level].label}${dir}`;
}

// ---- 予報 ----

function buildForecastUrl_(lat, lon) {
  return [
    `${OPEN_METEO_URL_}?latitude=${Number(lat).toFixed(2)}`,
    `longitude=${Number(lon).toFixed(2)}`,
    'hourly=pressure_msl,temperature_2m,precipitation_probability',
    'daily=temperature_2m_max',
    `timezone=${encodeURIComponent(timeZone_())}`,
    // 0時の「3時間の変わり方」と、前の日の最高気温に要る
    'past_days=1',
    'forecast_days=2'
  ].join('&');
}

// Open-Meteo の返事 → { days: { 'yyyy-MM-dd': [{ hour, hpa, temp, pop, change, level }] }, maxTemps }。読めないときは null
function parseForecast_(json) {
  const hourly = json && json.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.pressure_msl)) return null;

  const finite = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const col = (name) => (Array.isArray(hourly[name]) ? hourly[name] : []);
  const hpaAt = {};
  hourly.time.forEach((time, index) => {
    hpaAt[String(time)] = finite(hourly.pressure_msl[index]);
  });

  const days = {};
  hourly.time.forEach((time, index) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(time))) return;
    const before = new Date(`${time}:00Z`);
    before.setUTCHours(before.getUTCHours() - 3);
    const hpa = hpaAt[time];
    const hpaBefore = hpaAt[before.toISOString().slice(0, 16)];
    const change = hpa !== null && hpaBefore !== null && hpaBefore !== undefined ? Math.round((hpa - hpaBefore) * 10) / 10 : null;
    const date = time.slice(0, 10);
    (days[date] = days[date] || []).push({
      hour: Number(time.slice(11, 13)),
      hpa: hpa,
      temp: finite(col('temperature_2m')[index]),
      pop: finite(col('precipitation_probability')[index]),
      change: change,
      level: soraqruLevelOf_(change)
    });
  });

  const daily = json.daily && typeof json.daily === 'object' ? json.daily : {};
  const maxTemps = {};
  (Array.isArray(daily.time) ? daily.time : []).forEach((date, index) => {
    maxTemps[date] = finite((Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [])[index]);
  });
  // daily がないときは1時間ごとの値から
  Object.keys(days).forEach((date) => {
    if (maxTemps[date] === null || maxTemps[date] === undefined) {
      const temps = days[date].map((row) => row.temp).filter((value) => value !== null);
      maxTemps[date] = temps.length ? Math.max(...temps) : null;
    }
  });

  return Object.keys(days).length ? { days: days, maxTemps: maxTemps } : null;
}

// その日の知らせ：[{ kind, emoji, title, text }]。何もなければ []
function evaluateNotice_(forecast, date) {
  const rows = (forecast && forecast.days && forecast.days[date]) || [];
  if (!rows.length) return [];
  const alerts = [];
  const rules = NOTICE_RULES_;

  // ☔ 雨：昼のあいだに降水確率が高い時間（続いた時間をまとめる）
  const rainRanges = [];
  rows
    .filter((row) => row.hour >= rules.rainFromHour && row.hour <= rules.rainToHour)
    .forEach((row) => {
      const last = rainRanges[rainRanges.length - 1];
      if (row.pop === null || row.pop < rules.rainPop) return;
      if (last && last.to === row.hour) {
        last.to = row.hour + 1;
        last.pop = Math.max(last.pop, row.pop);
      } else {
        rainRanges.push({ from: row.hour, to: row.hour + 1, pop: row.pop });
      }
    });
  if (rainRanges.length) {
    alerts.push({ kind: 'rain', emoji: '☔', title: '雨', lines: rainRanges.slice(0, 3).map((r) => `${r.from}〜${r.to}時 雨 ${Math.round(r.pop)}%`) });
  }

  // 🌀 気圧：そらくると同じ目安で「注意」「警戒」の時間
  const pressureRanges = soraqruAlertRanges_(rows).filter((range) => range.level >= rules.pressureLevel);
  if (pressureRanges.length) {
    alerts.push({ kind: 'pressure', emoji: '🌀', title: '気圧の変化', lines: pressureRanges.slice(0, 3).map(soraqruRangeText_) });
  }

  // 🌡️ 気温：最高気温が前の日より大きくちがう
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const todayMax = forecast.maxTemps && forecast.maxTemps[date];
  const previousMax = forecast.maxTemps && forecast.maxTemps[previous.toISOString().slice(0, 10)];
  if (Number.isFinite(todayMax) && Number.isFinite(previousMax) && Math.abs(todayMax - previousMax) >= rules.tempDiff) {
    const diff = Math.round(todayMax - previousMax);
    alerts.push({
      kind: 'temp',
      emoji: diff > 0 ? '🥵' : '🥶',
      title: '気温',
      lines: [`最高 ${Math.round(todayMax)}℃（前の日より ${Math.abs(diff)}℃ ${diff > 0 ? '高い' : '低い'}）`]
    });
  }

  return alerts;
}

/**
 * 同じ地点は1回の実行で1回だけ聞く。混んでいて断られた（429）ときは、少し待って1回だけやりなおす。
 * それでもだめなら投げる（呼んだ側で、その地点は送らずに記録する）
 */
function fetchForecast_(lat, lon, memo) {
  const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  if (memo && Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
  const url = buildForecastUrl_(lat, lon);
  let response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() === 429) {
    Utilities.sleep(3000);
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  }
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(`Open-Meteo ${code}`);
  let json = null;
  try {
    json = JSON.parse(response.getContentText());
  } catch (error) {
    json = null;
  }
  const forecast = parseForecast_(json);
  if (!forecast) throw new Error('Open-Meteo の中身が読めない');
  if (memo) memo[key] = forecast;
  return forecast;
}

// ---- 地名（国土地理院の逆ジオコーダー → 市区町村のコード → そらくるの表。そらくるの js/place-name.js と同じ）。だめなら '' ----

function lookupPlaceName_(lat, lon) {
  try {
    const geo = UrlFetchApp.fetch(`${GSI_REVERSE_GEOCODER_URL_}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, { muteHttpExceptions: true });
    if (geo.getResponseCode() !== 200) return '';
    const results = (JSON.parse(geo.getContentText()) || {}).results || {};
    const cd = results.muniCd;
    const code = typeof cd === 'string' && /^\d{4,6}$/.test(cd) ? String(Number(cd)) : '';
    const table = readMuniTable_();
    const name = code && table && Object.prototype.hasOwnProperty.call(table, code) ? table[code] : '';
    return typeof name === 'string' ? cleanText_(name, 20) : '';
  } catch (error) {
    return '';
  }
}

function readMuniTable_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('SORAQRU_MUNI_V1');
  if (cached) return JSON.parse(cached);
  const response = UrlFetchApp.fetch(SORAQRU_MUNI_URL_, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const text = response.getContentText();
  try {
    cache.put('SORAQRU_MUNI_V1', text, 21600);
  } catch (error) {
    // 覚えられなくても、今回は使える
  }
  return JSON.parse(text);
}

/** 外から来た文字：決まった長さまで・1行に（絵文字を半分にしない） */
function cleanText_(value, max) {
  return Array.from(String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, max).join('');
}
