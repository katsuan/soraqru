/**
 * 5_line.gs：LINE の Messaging API（返事・push・入力中・プロフィール・push の残り）
 */

const LINE_API_ = 'https://api.line.me/v2/bot';
const LINE_DATA_API_ = 'https://api-data.line.me/v2/bot';

function lineRequest_(method, path, body, base) {
  const token = lineToken_();
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN がない');
  const options = {
    method: method,
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  return UrlFetchApp.fetch(`${base || LINE_API_}/${path}`, options);
}

function lineGet_(path) {
  try {
    const res = lineRequest_('get', path);
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  } catch (error) {
    return null;
  }
}

/**
 * 返事。カードが断られたら（400）、文だけの返事にして push で送りなおす（返事の合図は1回しか使えない。ux.md の H5）。
 * 断られたことは「動作の記録」に残す（中身のくわしいことは画面・LINE に出さない）
 */
function reply_(event, messages) {
  const list = (messages || []).filter(Boolean).slice(0, 5);
  if (!list.length || !event || !event.replyToken) return false;
  const res = lineRequest_('post', 'message/reply', { replyToken: event.replyToken, messages: list });
  const code = res.getResponseCode();
  if (code === 200) return true;
  writeLog_('reply:error', `${code} ${String(res.getContentText()).slice(0, 300)}`);
  if (code === 400 && list.some((m) => m.type === 'flex')) {
    const to = targetOf_(event).targetId;
    if (to) push_(to, [textMessage_(fallbackText_(list))]);
  }
  return false;
}

function push_(to, messages) {
  const res = lineRequest_('post', 'message/push', { to: to, messages: (messages || []).slice(0, 5) });
  const code = res.getResponseCode();
  if (code !== 200) {
    writeLog_('push:error', `${code} ${String(res.getContentText()).slice(0, 300)}`);
    if (code === 400 && messages.some((m) => m.type === 'flex')) {
      const again = lineRequest_('post', 'message/push', { to: to, messages: [textMessage_(fallbackText_(messages))] });
      return again.getResponseCode() === 200;
    }
    return false;
  }
  return true;
}

// カードが通らなかったときの文（altText をつなぐ）
function fallbackText_(messages) {
  const lines = messages.map((m) => (m.type === 'flex' ? m.altText : m.text)).filter(Boolean);
  return `${lines.join('\n')}\n（カードを出せなかったので、文で送りました）`.slice(0, 4900);
}

/** 返事に時間がかかる前の「入力中…」（1対1 だけ。ux.md の H1） */
function showLoading_(event) {
  const userId = event && event.source && event.source.type === 'user' ? event.source.userId : '';
  if (!userId) return;
  try {
    lineRequest_('post', 'chat/loading/start', { chatId: userId, loadingSeconds: 10 });
  } catch (error) {
    // 出せなくても返事はする
  }
}

function displayNameOf_(userId) {
  const profile = userId ? lineGet_(`profile/${encodeURIComponent(userId)}`) : null;
  return profile ? cleanText_(profile.displayName, 30) : '';
}

/** 今月の push に余りがあるか。上限がない・読めないときは送る */
function hasPushRoom_() {
  const quota = lineGet_('message/quota');
  if (!quota || quota.type !== 'limited' || !Number.isFinite(Number(quota.value))) return true;
  const usage = Number((lineGet_('message/quota/consumption') || {}).totalUsage);
  return !Number.isFinite(usage) || usage < Number(quota.value) * NOTICE_QUOTA_RATE_;
}

/** このトークの送り先（1対1 なら本人、グループ・ルームならそのトーク） */
function targetOf_(event) {
  const source = (event && event.source) || {};
  if (source.type === 'group') return { targetType: 'group', targetId: String(source.groupId || '').trim() };
  if (source.type === 'room') return { targetType: 'room', targetId: String(source.roomId || '').trim() };
  return { targetType: 'user', targetId: String(source.userId || '').trim() };
}

function textMessage_(text, quickItems) {
  const message = { type: 'text', text: String(text).slice(0, 4900) };
  if (quickItems && quickItems.length) message.quickReply = { items: quickItems.slice(0, 13).map((action) => ({ type: 'action', action: action })) };
  return message;
}

function withQuickReply_(message, quickItems) {
  if (quickItems && quickItems.length) message.quickReply = { items: quickItems.slice(0, 13).map((action) => ({ type: 'action', action: action })) };
  return message;
}

/** 押すと返事が来るボタン（postback）。ラベルは20字まで（クイックリプライ）、displayText は押した人のトークに出る文 */
function postback_(label, data, displayText) {
  return { type: 'postback', label: Array.from(label).slice(0, 20).join(''), data: data, displayText: displayText || label };
}

function parsePostback_(data) {
  const out = {};
  String(data || '').split('&').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > 0) out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}
