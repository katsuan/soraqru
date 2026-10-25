// 99_selfcheck.gs：使う前の確かめ（Q ツール共通。q-oqrn/tools/qtest/selfcheck.gs をそのまま写したもの）。GAS エディタで qCheckAll を実行する
/**
 * 使う前の確かめ（Q のツール共通。GAS エディタで qCheckAll を実行する）。
 * 何も書きこまない・送らない（LINE には「確かめるだけ」の API を使う）。結果は実行ログに一覧で出る。
 *
 * 使い方：このファイルを GAS のプロジェクトにコピーし（ファイル名は 99_selfcheck など）、
 * プロジェクトのどこかに Q_SELF_CHECK を書く。足りない項目は書かなくてよい（その確かめを飛ばす）。
 *
 *   var Q_SELF_CHECK = {
 *     properties: ['LINE_CHANNEL_ACCESS_TOKEN', 'LIFF_ID'],     // なくてはいけない Script Properties（値は出さない）
 *     secretProperties: ['LINE_CHANNEL_ACCESS_TOKEN'],           // 鍵：コードに同じ値が書かれていないかも見る
 *     spreadsheetId: function () { return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'); },
 *     sheets: { users: ['userId', 'displayName'], meal_logs: ['mealDate', 'userId'] }, // シートと、1行目の見出し
 *     lineTokenProperty: 'LINE_CHANNEL_ACCESS_TOKEN',
 *     cards: function () { return [buildDailySummaryFlexMessage('Utest', {})]; },     // LINE に確かめてもらうメッセージ
 *     richMenus: true,                                           // リッチメニューを確かめる
 *     triggers: ['send20hReminderNotifications'],                // あるはずの時間のトリガー
 *     heartbeats: { hourlyJob: 130 },                            // 最後に動いてから何分以内なら ✅（関数の頭で qHeartbeat('hourlyJob')）
 *     webAppUrlProperty: 'WEBAPP_URL',                           // Webhook の URL と同じか
 *   };
 *
 * 結果の印：✅ だいじょうぶ／⚠️ 見てほしい／❌ 直す
 */

function qCheckAll() {
  var results = [];
  var add = function (level, area, text) {
    results.push({ level: level, area: area, text: text });
  };
  var steps = [qCheckProperties_, qCheckSheets_, qCheckLine_, qCheckCards_, qCheckRichMenus_, qCheckTriggers_];
  steps.forEach(function (step) {
    try {
      step(add);
    } catch (error) {
      add('❌', step.name.replace(/^qCheck|_$/g, ''), '確かめの途中で止まりました：' + error.message);
    }
  });
  var mark = { '✅': 0, '⚠️': 0, '❌': 0 };
  results.forEach(function (r) {
    mark[r.level] = (mark[r.level] || 0) + 1;
    console.log(r.level + ' [' + r.area + '] ' + r.text);
  });
  console.log('---- ✅ ' + mark['✅'] + '　⚠️ ' + mark['⚠️'] + '　❌ ' + mark['❌']);
  return { ok: !mark['❌'], results: results };
}

function qSelfCheckConfig_() {
  return typeof Q_SELF_CHECK === 'undefined' ? {} : Q_SELF_CHECK;
}

// Script Properties：なくてはいけないものがあるか（値は出さない）
function qCheckProperties_(add) {
  var config = qSelfCheckConfig_();
  var props = PropertiesService.getScriptProperties().getProperties();
  (config.properties || []).forEach(function (key) {
    if (props[key]) add('✅', '設定', key + ' がある');
    else add('❌', '設定', key + ' がない（スクリプト プロパティに入れる）');
  });
  // 鍵の値が、コードの中の文字と同じになっていないか（コードに書いてしまっていないか）
  (config.secretProperties || []).forEach(function (key) {
    var value = props[key];
    if (!value || value.length < 12) return;
    var found = qSourceContains_(value);
    if (found === null) add('⚠️', '設定', key + '：コードの中は確かめられませんでした');
    else if (found) add('❌', '設定', key + ' と同じ文字がコードに書かれています（消して、鍵を作りなおす）');
    else add('✅', '設定', key + ' はコードに書かれていない');
  });
}

// コードの中に文字があるか（Apps Script API が使えるときだけ。使えなければ null）
function qSourceContains_(text) {
  try {
    var url = 'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content';
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText()).files.some(function (f) {
      return String(f.source || '').indexOf(text) !== -1;
    });
  } catch (error) {
    return null;
  }
}

// シート：あるか・1行目の見出しがそろっているか（読むだけ）
function qCheckSheets_(add) {
  var config = qSelfCheckConfig_();
  if (!config.sheets) return;
  var id = typeof config.spreadsheetId === 'function' ? config.spreadsheetId() : config.spreadsheetId;
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  if (!book) return add('❌', 'シート', 'スプレッドシートが開けません');
  Object.keys(config.sheets).forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return add('❌', 'シート', name + ' がない');
    var want = config.sheets[name] || [];
    var head = want.length ? sheet.getRange(1, 1, 1, want.length).getValues()[0] : [];
    var missing = want.filter(function (col, i) {
      return head[i] !== col;
    });
    if (missing.length) add('⚠️', 'シート', name + ' の見出しがちがう：' + missing.join('・'));
    else add('✅', 'シート', name + '（' + sheet.getLastRow() + ' 行）');
    // 外からの文字が式のまま入っていないか（= + - @ で始まる文字の数）
    var values = sheet.getDataRange().getValues();
    var formulas = sheet.getDataRange().getFormulas();
    var suspicious = 0;
    for (var r = 1; r < formulas.length; r++) {
      for (var c = 0; c < formulas[r].length; c++) {
        if (formulas[r][c] && /HYPERLINK|IMPORT|WEBSERVICE|IMAGE/i.test(formulas[r][c])) suspicious++;
      }
    }
    if (suspicious) add('❌', 'シート', name + ' に、外につながる式が ' + suspicious + ' か所（入れた人と中身を確かめる）');
    if (values.length > 40000) add('⚠️', 'シート', name + ' が ' + values.length + ' 行（読むのが遅くなる。古い行を移す）');
  });
}

function qLineToken_() {
  var config = qSelfCheckConfig_();
  var key = config.lineTokenProperty || 'LINE_CHANNEL_ACCESS_TOKEN';
  return PropertiesService.getScriptProperties().getProperty(key);
}

function qLineGet_(path) {
  var res = UrlFetchApp.fetch('https://api.line.me' + path, {
    headers: { Authorization: 'Bearer ' + qLineToken_() },
    muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

// LINE：鍵が使えるか・Webhook の行き先
function qCheckLine_(add) {
  var config = qSelfCheckConfig_();
  if (!qLineToken_()) return config.lineTokenProperty ? add('❌', 'LINE', '鍵がない') : undefined;
  var info = qLineGet_('/v2/bot/info');
  if (info.code !== 200) return add('❌', 'LINE', '鍵が使えません（' + info.code + '）。作りなおして入れなおす');
  add('✅', 'LINE', 'ボット「' + JSON.parse(info.body).displayName + '」につながる');
  var hook = qLineGet_('/v2/bot/channel/webhook/endpoint');
  if (hook.code === 200) {
    var endpoint = JSON.parse(hook.body);
    if (!endpoint.active) add('❌', 'LINE', 'Webhook が使われていない（LINE Developers で「Webhook の利用」をオンに）');
    var expected = config.webAppUrlProperty ? PropertiesService.getScriptProperties().getProperty(config.webAppUrlProperty) : '';
    if (expected && String(endpoint.endpoint || '').indexOf(expected.split('?')[0]) !== 0) {
      add('⚠️', 'LINE', 'Webhook の URL が ' + config.webAppUrlProperty + ' とちがう');
    } else if (endpoint.active) {
      add('✅', 'LINE', 'Webhook が使われている' + (/[?&]key=/.test(endpoint.endpoint || '') ? '（合言葉つき）' : ''));
    }
    if (!/[?&]key=/.test(endpoint.endpoint || '')) add('⚠️', 'LINE', 'Webhook の URL に合言葉（?key=）がない。だれでも偽の知らせを送れる');
  }
}

// カード：LINE に「送れるか」だけ確かめてもらう（送らない）
function qCheckCards_(add) {
  var config = qSelfCheckConfig_();
  if (typeof config.cards !== 'function' || !qLineToken_()) return;
  var messages = config.cards() || [];
  for (var i = 0; i < messages.length; i += 5) {
    var chunk = messages.slice(i, i + 5);
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/validate/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + qLineToken_() },
      payload: JSON.stringify({ messages: chunk }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) add('✅', 'カード', (i + 1) + '〜' + (i + chunk.length) + ' 通目は送れる形');
    else add('❌', 'カード', (i + 1) + '〜' + (i + chunk.length) + ' 通目が断られる：' + res.getContentText().slice(0, 300));
  }
}

// リッチメニュー：いつものメニューがあるか・数
function qCheckRichMenus_(add) {
  var config = qSelfCheckConfig_();
  if (!config.richMenus || !qLineToken_()) return;
  var list = qLineGet_('/v2/bot/richmenu/list');
  if (list.code !== 200) return add('❌', 'メニュー', '一覧が読めません（' + list.code + '）');
  var menus = JSON.parse(list.body).richmenus || [];
  add(menus.length > 900 ? '⚠️' : '✅', 'メニュー', 'リッチメニュー ' + menus.length + ' 個（上限 1000）');
  var def = qLineGet_('/v2/bot/user/all/richmenu');
  if (def.code === 200) add('✅', 'メニュー', 'いつものメニューがある');
  else add('⚠️', 'メニュー', 'いつものメニューがない');
}

// トリガー：あるはずの時間のトリガーがあるか・動いているか。
// heartbeats を書いた関数は、トリガーの一覧ではなく「最後に動いた時刻」で見る（qHeartbeat を関数の頭で呼ぶ）。
// ライブラリとして入口の GAS から呼ばれると、トリガーの一覧は入口のものしか見えないため。
function qCheckTriggers_(add) {
  var config = qSelfCheckConfig_();
  var beats = config.heartbeats || {};
  var names = (config.triggers || []).slice();
  Object.keys(beats).forEach(function (name) {
    if (names.indexOf(name) === -1) names.push(name);
  });
  if (!names.length) return;
  var have = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  names.forEach(function (name) {
    var limit = beats[name];
    if (!limit) {
      if (have.indexOf(name) !== -1) add('✅', 'トリガー', name);
      else add('❌', 'トリガー', name + ' のトリガーがない');
      return;
    }
    var last = PropertiesService.getScriptProperties().getProperty(qHeartbeatKey_(name));
    if (!last) return add('⚠️', 'トリガー', name + '：動いた記録がまだない（次に動くと出る。続くならトリガーを確かめる）');
    var lastDate = new Date(last);
    var when = Utilities.formatDate(lastDate, Session.getScriptTimeZone(), 'M/d H:mm');
    if ((Date.now() - lastDate.getTime()) / 60000 <= limit) add('✅', 'トリガー', name + '（前回 ' + when + '）');
    else add('❌', 'トリガー', name + ' が前回 ' + when + ' から動いていない（トリガーとエラーを確かめる）');
  });
}

// 時間のトリガーで動く関数の頭で呼ぶ：最後に動いた時刻を Script Properties に覚える
function qHeartbeat(name) {
  try {
    PropertiesService.getScriptProperties().setProperty(qHeartbeatKey_(name), new Date().toISOString());
  } catch (error) {
    console.warn('qHeartbeat', error);
  }
}

function qHeartbeatKey_(name) {
  return 'Q_HEARTBEAT_' + name;
}

/**
 * シートに書く文字が、式として動かないようにする（= + - @ で始まるときは前に ' を付ける）。
 * 外から来た文字（LINE・画面で入れた名前・メモなど）をシートに書くときは、かならずこれを通す。
 * 数（数字だけの文字も）・日付・真偽はそのまま。
 */
function safeCell(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value)) return "'" + value;
  return value;
}
