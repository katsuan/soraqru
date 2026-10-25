/**
 * 6_sheet.gs：シート（地点・使う人・動作の記録）。シートはこの GAS がついているスプレッドシート（配布用シートのコピー）
 * 外から来た文字は、= + - @ で始まると式として動くので safeCell を通して書く（docs/security.md の G1）
 */

function book_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** シート（なければ見出しつきで作る） */
function sheet_(kind) {
  const def = SHEETS_[kind];
  const book = book_();
  let sheet = book.getSheetByName(def.name);
  if (!sheet) {
    sheet = book.insertSheet(def.name);
    sheet.appendRow(def.headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 行を { 見出し: 値 } で読む（1回の呼び出しで1回だけ） */
function readRows_(kind) {
  if (memo_[kind]) return memo_[kind];
  const values = sheet_(kind).getDataRange().getValues();
  const headers = (values[0] || []).map((h) => String(h).trim());
  memo_[kind] = values.slice(1).map((row, i) => {
    const out = { _row: i + 2 };
    headers.forEach((h, j) => {
      out[h] = row[j];
    });
    return out;
  });
  return memo_[kind];
}

function appendRow_(kind, data) {
  const def = SHEETS_[kind];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_(kind).appendRow(def.headers.map((h) => safeCell(data[h] === undefined ? '' : data[h])));
  } finally {
    lock.releaseLock();
  }
  delete memo_[kind];
}

/** 1つの行の、いくつかの列を書きかえる（keyColumn が key の行） */
function updateRow_(kind, keyColumn, key, changes) {
  const def = SHEETS_[kind];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = sheet_(kind);
    const values = sheet.getDataRange().getValues();
    const headers = (values[0] || []).map((h) => String(h).trim());
    const keyIndex = headers.indexOf(keyColumn);
    for (let i = 1; i < values.length; i += 1) {
      if (String(values[i][keyIndex] || '').trim() !== key) continue;
      Object.keys(changes).forEach((column) => {
        const j = headers.indexOf(column);
        if (j >= 0) sheet.getRange(i + 1, j + 1).setValue(safeCell(changes[column]));
      });
      const updated = headers.indexOf('updatedAt');
      if (updated >= 0 && def.headers.includes('updatedAt')) sheet.getRange(i + 1, updated + 1).setValue(new Date());
      delete memo_[kind];
      return true;
    }
  } finally {
    lock.releaseLock();
  }
  return false;
}

const isOn_ = (value) => value === true || String(value).toUpperCase() === 'TRUE';

/** 見ている地点 */
function activeNotices_() {
  return readRows_('notices')
    .filter((row) => isOn_(row.isActive))
    .map((row) => ({
      noticeId: String(row.noticeId || '').trim(),
      ownerUserId: String(row.ownerUserId || '').trim(),
      targetType: String(row.targetType || '').trim(),
      targetId: String(row.targetId || '').trim(),
      placeName: cleanText_(row.placeName, 20) || '登録した地点',
      lat: Number(row.lat),
      lon: Number(row.lon),
      notifyHour: Number(row.notifyHour),
      lastCheckedDate: row.lastCheckedDate instanceof Date ? formatDay_(row.lastCheckedDate) : String(row.lastCheckedDate || '').trim()
    }))
    .filter((n) => n.noticeId && n.targetId && Number.isFinite(n.lat) && Number.isFinite(n.lon) && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180);
}

/** 持ち主が許した人の ID */
function allowedMemberIds_() {
  return readRows_('members')
    .filter((row) => String(row.status).trim() === 'allowed')
    .map((row) => String(row.userId || '').trim())
    .filter(Boolean);
}

function memberRow_(userId) {
  return readRows_('members').find((row) => String(row.userId || '').trim() === userId) || null;
}

/** 動作の記録（システム管理者がシートで見る。LINE の ID は書かない） */
function writeLog_(step, summary) {
  try {
    const sheet = sheet_('log');
    sheet.appendRow([new Date(), safeCell(step), safeCell(String(summary || '').replace(/U[0-9a-f]{32}/g, 'U…'))]);
    // 古いものから消す（500行まで）
    const extra = sheet.getLastRow() - 501;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (error) {
    console.error(`LOG_FAILED: ${step}`);
  }
}
