/**
 * 2_main.gs：入口（LINE の Webhook）と、決めた時間の見張り
 *
 * Webhook の URL は「ウェブアプリの URL ? key = WEBHOOK_KEY」（setupBot・showWebhookUrl が出す）。
 * GAS は LINE の署名（ヘッダー）を読めないので、合言葉が合わない呼び出しは何もしない（docs/security.md の G3）。
 * 返すのはいつも同じ空の返事（中身・エラーは返さない）。
 */

// qcheck-ok: G3 Webhook の合言葉（WEBHOOK_KEY）を最後まで比べ、合わなければ何もしない。操作ごとの役割は handlePostback_ と roleOf_ で見る
function doPost(e) {
  const key = propText_('WEBHOOK_KEY');
  const given = String((e && e.parameter && e.parameter.key) || '');
  if (!key || !sameText_(given, key)) return okOutput_();
  let body = null;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return okOutput_();
  }
  const events = Array.isArray(body && body.events) ? body.events.slice(0, 20) : [];
  events.forEach((event) => {
    try {
      handleEvent_(event);
    } catch (error) {
      console.error(`EVENT_FAILED: ${error.message}`);
      writeLog_('event:error', error.message);
    }
  });
  return okOutput_();
}

function doGet() {
  return ContentService.createTextOutput(`${BOT_NAME_}（版 ${BOT_VERSION_}）`);
}

function okOutput_() {
  return ContentService.createTextOutput('{}').setMimeType(ContentService.MimeType.JSON);
}

// 合言葉は最後まで比べる（途中で止めると、合っている長さが時間でわかってしまう）
function sameText_(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const OWNER_CLAIM_PATTERN_ = /^[#＃]\s*(持ち主|もちぬし|owner)$/iu;
const TEST_PATTERN_ = /^[#＃]\s*(テスト|てすと|test)$/iu;
const MENU_WORDS_ = [NOTICE_LABEL_, '天気の知らせ', 'メニュー'];

function handleEvent_(event) {
  if (!event || event.mode === 'standby') return;
  const source = event.source || {};
  const userId = String(source.userId || '').trim();
  const isUser = source.type === 'user';

  if (event.type === 'follow') return reply_(event, [buildWelcomeCard_(roleOf_(userId), Boolean(ownerUserId_()))]);
  if (event.type === 'join') return reply_(event, [textMessage_(`${BOT_NAME_}です。この${source.type === 'room' ? 'トーク' : 'グループ'}に、雨・気圧・気温で知らせることがある日だけ送れます。`, [postback_(NOTICE_LABEL_, 'a=menu')])]);
  if (event.type === 'postback') return handlePostback_(event, parsePostback_(event.postback && event.postback.data));
  if (event.type !== 'message' || !event.message) return;

  if (event.message.type === 'location') return reply_(event, locationReply_(event));
  if (event.message.type !== 'text') return;

  const text = String(event.message.text || '').trim();
  if (OWNER_CLAIM_PATTERN_.test(text) && isUser) return reply_(event, [ownerClaimReply_(userId)]);
  // #テスト は持ち主の1対1 だけ。ほかの人には知らない言葉と同じ返事（窓口があることを見せない。ux.md の H11）
  if (TEST_PATTERN_.test(text) && isUser && roleOf_(userId) === 'owner') return reply_(event, [buildTestWindowCard_()]);
  if (MENU_WORDS_.includes(text)) return reply_(event, [listReply_(event)]);
  // グループでは、決まった言葉にだけ返す（ふだんの会話にまじらない）
  if (isUser) return reply_(event, [helpText_(roleOf_(userId))]);
}

function helpText_(role) {
  return role
    ? textMessage_('下のボタンから選んでね。', [postback_(NOTICE_LABEL_, 'a=menu'), postback_('📍 地点を足す', 'a=add')])
    : textMessage_('このボットは、持ち主が許した人だけが使えます。', ownerUserId_() ? [postback_('🙋 使いたいと伝える', 'a=request'), postback_(NOTICE_LABEL_, 'a=menu')] : [postback_('🔑 持ち主の登録', 'a=owner')]);
}

function handlePostback_(event, p) {
  const userId = String((event.source && event.source.userId) || '').trim();
  const role = roleOf_(userId);
  const a = String(p.a || '');
  // 持ち主だけのもの（ほかの人が押しても、前のボタンが残っていても、何も変えない）
  if (a === 'allow' || a === 'deny' || a === 'members' || a === 'unallow' || a === 'test') {
    if (role !== 'owner') return reply_(event, [textMessage_('これは持ち主だけが使えます。')]);
    if (a === 'members') return reply_(event, [buildMembersCard_(membersForCard_())]);
    if (a === 'test') return reply_(event, testWindowReply_(event, String(p.t || '')));
    return reply_(event, [memberDecisionReply_(a, String(p.u || ''))]);
  }
  switch (a) {
    case 'menu':
      return reply_(event, [listReply_(event)]);
    case 'owner':
      return reply_(event, [event.source && event.source.type === 'user' ? ownerClaimReply_(userId) : textMessage_('持ち主の登録は、ボットとの1対1 のトークでしてね。')]);
    case 'request':
      return reply_(event, [memberRequestReply_(event)]);
    case 'add':
      return reply_(event, [addReply_(event)]);
    case 'edit':
      return reply_(event, [role ? textMessage_('どうする？', [postback_('⏰ 時間をかえる', 'a=pick&m=time'), postback_('🗑️ やめる地点', 'a=pick&m=remove')]) : notAllowedText_()]);
    case 'pick':
      return reply_(event, [pickReply_(event, p.m === 'remove' ? 'remove' : 'time')]);
    case 'hours':
      return reply_(event, [hoursReply_(event, String(p.id || ''))]);
    case 'time':
      return reply_(event, [timeReply_(event, String(p.id || ''), Number(p.h))]);
    case 'remove':
      return reply_(event, [removeReply_(event, String(p.id || ''))]);
    default:
      return reply_(event, [helpText_(role)]);
  }
}

function notAllowedText_() {
  return textMessage_('地点を足したり変えたりするには、このボットの持ち主の許可が要ります。', ownerUserId_() ? [postback_('🙋 使いたいと伝える', 'a=request')] : []);
}

// ---- 一覧・地点を足す・時間・やめる ----

function noticesOfTarget_(event) {
  const target = targetOf_(event);
  return activeNotices_().filter((n) => n.targetId === target.targetId);
}

function listReply_(event) {
  return buildListCard_(noticesOfTarget_(event), roleOf_(event.source && event.source.userId));
}

function pendingKey_(event) {
  return `PENDING_${targetOf_(event).targetId}_${String((event.source && event.source.userId) || '').trim()}`;
}

// 「📍 地点を足す」：位置情報を送るクイックリプライ。押した人の位置情報だけを、10分のあいだ受けとる
function addReply_(event) {
  const userId = String((event.source && event.source.userId) || '').trim();
  if (!canUse_(userId)) return notAllowedText_();
  const active = activeNotices_();
  if (active.filter((n) => n.ownerUserId === userId).length >= NOTICE_MAX_PER_PERSON_) {
    return textMessage_(`地点は1人${NOTICE_MAX_PER_PERSON_}か所までです。「🗑️ やめる地点」から減らしてね。`, [postback_('🗑️ やめる地点', 'a=pick&m=remove')]);
  }
  if (active.length >= NOTICE_MAX_TOTAL_) return textMessage_(`このボットで見られる地点は${NOTICE_MAX_TOTAL_}か所までです。持ち主に相談してね。`);
  CacheService.getScriptCache().put(pendingKey_(event), '1', NOTICE_PENDING_SECONDS_);
  return textMessage_('天気を知らせる場所を、下の「📍 位置情報を送る」から送ってね（10分のあいだ）。\n位置は1kmくらいに丸めて覚えます。', [{ type: 'location', label: '📍 位置情報を送る' }]);
}

// 位置情報：「📍 地点を足す」を押した人のものだけ登録する
function locationReply_(event) {
  const cache = CacheService.getScriptCache();
  const key = pendingKey_(event);
  if (!cache.get(key)) {
    return event.source && event.source.type === 'user' ? [textMessage_('地点を足すときは、「📍 地点を足す」を押してから送ってね。', [postback_('📍 地点を足す', 'a=add')])] : [];
  }
  cache.remove(key);
  const userId = String((event.source && event.source.userId) || '').trim();
  if (!canUse_(userId)) return [notAllowedText_()];

  const lat = Math.round(Number(event.message.latitude) * 100) / 100;
  const lon = Math.round(Number(event.message.longitude) * 100) / 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return [textMessage_('場所が読めませんでした。「📍 地点を足す」から、もう一度送ってね。', [postback_('📍 地点を足す', 'a=add')])];
  }
  const target = targetOf_(event);
  const active = activeNotices_();
  if (active.some((n) => n.targetId === target.targetId && n.lat === lat && n.lon === lon)) return [textMessage_('この場所は、もう登録しています。', [postback_(NOTICE_LABEL_, 'a=menu')])];
  if (active.filter((n) => n.ownerUserId === userId).length >= NOTICE_MAX_PER_PERSON_) return [textMessage_(`地点は1人${NOTICE_MAX_PER_PERSON_}か所までです。`)];
  if (active.length >= NOTICE_MAX_TOTAL_) return [textMessage_(`このボットで見られる地点は${NOTICE_MAX_TOTAL_}か所までです。`)];

  showLoading_(event);
  const placeName = lookupPlaceName_(lat, lon) || cleanText_(event.message.title, 20) || '登録した地点';
  const notice = {
    noticeId: Utilities.getUuid(),
    ownerUserId: userId,
    targetType: target.targetType,
    targetId: target.targetId,
    placeName: placeName,
    lat: lat,
    lon: lon,
    notifyHour: NOTICE_DEFAULT_HOUR_,
    isActive: true,
    lastCheckedDate: '',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  appendRow_('notices', notice);
  return [textMessage_(
    QSeason.decorate(`📍 ${placeName} を登録しました。\n${formatHour_(notice.notifyHour)}ごろ、雨・気圧・気温で知らせることがある日だけ、このトークに送ります。時間は下から変えられます。`),
    hourActions_(notice)
  )];
}

function hourActions_(notice) {
  return NOTICE_HOURS_.map((hour) => postback_(
    `⏰ ${hour >= NOTICE_EVENING_FROM_ ? `${hour}時（明日のぶん）` : `${hour}時`}`,
    `a=time&id=${encodeURIComponent(notice.noticeId)}&h=${hour}`,
    `⏰ ${notice.placeName}：${formatHour_(hour)}`
  ));
}

/** 変えてよい地点：このトークの地点で、持ち主か、その地点を足した本人 */
function editableNotice_(event, noticeId) {
  const userId = String((event.source && event.source.userId) || '').trim();
  const role = roleOf_(userId);
  if (!role) return null;
  return noticesOfTarget_(event).find((n) => n.noticeId === noticeId && (role === 'owner' || n.ownerUserId === userId)) || null;
}

function pickReply_(event, mode) {
  const userId = String((event.source && event.source.userId) || '').trim();
  const role = roleOf_(userId);
  if (!role) return notAllowedText_();
  const notices = noticesOfTarget_(event).filter((n) => role === 'owner' || n.ownerUserId === userId);
  if (!notices.length) return textMessage_('あなたが変えられる地点は、このトークにはありません。', [postback_('📍 地点を足す', 'a=add')]);
  const actions = notices.map((n) => (mode === 'remove'
    ? postback_(`🗑️ ${n.placeName}`, `a=remove&id=${encodeURIComponent(n.noticeId)}`, `🗑️ ${n.placeName}の知らせをやめる`)
    : postback_(`⏰ ${n.placeName}`, `a=hours&id=${encodeURIComponent(n.noticeId)}`, `⏰ ${n.placeName}の時間をかえる`)));
  return textMessage_(mode === 'remove' ? 'どの地点の知らせをやめる？' : 'どの地点の時間をかえる？', actions);
}

function hoursReply_(event, noticeId) {
  const notice = editableNotice_(event, noticeId);
  if (!notice) return textMessage_('この地点は、もうやめているかもしれません。', [postback_(NOTICE_LABEL_, 'a=menu')]);
  return textMessage_(`📍 ${notice.placeName}（いまは${formatHour_(notice.notifyHour)}）。何時にする？`, hourActions_(notice));
}

function timeReply_(event, noticeId, hour) {
  const notice = editableNotice_(event, noticeId);
  if (!notice) return textMessage_('この地点は、もうやめているかもしれません。', [postback_(NOTICE_LABEL_, 'a=menu')]);
  if (!NOTICE_HOURS_.includes(hour)) return textMessage_('この時間はえらべません。', hourActions_(notice));
  if (notice.notifyHour !== hour) updateRow_('notices', 'noticeId', notice.noticeId, { notifyHour: hour, lastCheckedDate: '' });
  return textMessage_(`⏰ ${notice.placeName}：${formatHour_(hour)}ごろに送ります（知らせることがある日だけ）。`, [postback_(NOTICE_LABEL_, 'a=menu')]);
}

function removeReply_(event, noticeId) {
  const notice = editableNotice_(event, noticeId);
  if (!notice) return textMessage_('この地点の知らせは、もうやめています。', [postback_(NOTICE_LABEL_, 'a=menu')]);
  updateRow_('notices', 'noticeId', notice.noticeId, { isActive: false });
  return textMessage_(`🗑️ ${notice.placeName}の知らせをやめました。`, [postback_(NOTICE_LABEL_, 'a=menu')]);
}

// ---- 決めた時間の見張り（setupBot が1時間おきのトリガーにする） ----

function hourlyWeatherNotice() {
  qHeartbeat('hourlyWeatherNotice');
  return runNotices_(new Date());
}

/** 決めた時間の地点だけ見て、知らせることがあれば push。1つの地点でつまずいても、ほかは続ける */
function runNotices_(now) {
  const hour = Number(Utilities.formatDate(now, timeZone_(), 'H'));
  const today = formatDay_(now);
  const date = hour >= NOTICE_EVENING_FROM_ ? formatDay_(new Date(now.getTime() + 24 * 3600 * 1000)) : today;
  const notices = activeNotices_().filter((n) => n.notifyHour === hour && n.lastCheckedDate !== today && canUse_(n.ownerUserId));
  const memo = {};
  const result = { checked: 0, sent: 0, failed: 0, skippedForQuota: 0 };
  let room = null;
  notices.forEach((notice) => {
    try {
      const alerts = evaluateNotice_(fetchForecast_(notice.lat, notice.lon, memo), date);
      if (alerts.length) {
        if (room === null) room = hasPushRoom_();
        if (!room) {
          result.skippedForQuota += 1;
          writeLog_('notice:quota', '今月の push の残りが少ないので送らない');
        } else if (push_(notice.targetId, [buildNoticeCard_(notice, date, alerts, { now: now })])) {
          result.sent += 1;
        } else {
          result.failed += 1;
        }
      }
      updateRow_('notices', 'noticeId', notice.noticeId, { lastCheckedDate: today });
      result.checked += 1;
    } catch (error) {
      result.failed += 1;
      writeLog_('notice:error', `${notice.placeName}：${error.message}`);
    }
  });
  if (notices.length) console.log(`天気の知らせ：見た ${result.checked}・送った ${result.sent}・失敗 ${result.failed}・残りが少なくて送らない ${result.skippedForQuota}`);
  return result;
}
