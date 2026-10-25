/**
 * 7_members.gs：持ち主（ツール管理者）と、持ち主が許した人（ユーザー）
 *
 * 持ち主の決め方（LOgBOT と同じ）
 *   1. ボットとの1対1 で「🔑 持ち主の登録」を押す（か「#持ち主」と送る）。候補として10分だけ覚える
 *   2. システム管理者が GAS エディタで adoptOwner（0_setup.gs）を実行する
 *   LINE だけでは持ち主になれない（GAS エディタを開ける人＝このシートの持ち主が決める）
 *
 * 使う人の決め方
 *   友だちになった人が「🙋 使いたいと伝える」を押す → 持ち主に知らせ（クイックリプライの「✅ 許す」「やめておく」）。
 *   許すのは1回きりの操作なので、カードのボタンにはしない（ux.md の H2）
 */

const OWNER_CANDIDATE_PROP_ = 'OWNER_CANDIDATE';

function ownerClaimReply_(userId) {
  if (!userId) return textMessage_('持ち主の登録は、ボットとの1対1 のトークでしてね。');
  if (userId === ownerUserId_()) return textMessage_('あなたは、このボットの持ち主として登録されています。', [postback_(NOTICE_LABEL_, 'a=menu'), postback_('👥 使う人', 'a=members')]);
  prop_.setProperty(OWNER_CANDIDATE_PROP_, JSON.stringify({ userId: userId, at: Date.now() }));
  return textMessage_([
    '🔑 持ち主の登録を受けつけました。',
    '10分以内に、このボットを作った人が GAS エディタで adoptOwner を実行すると、持ち主になります。'
  ].join('\n'));
}

/** 「🙋 使いたいと伝える」：持ち主に知らせる（1人1日1回まで。push を使うため） */
function memberRequestReply_(event) {
  const userId = String((event.source && event.source.userId) || '').trim();
  const owner = ownerUserId_();
  if (!userId) return textMessage_('1対1 のトークで押してね。');
  if (!owner) return textMessage_('まだ持ち主が決まっていません。');
  if (canUse_(userId)) return textMessage_('もう使えます。', [postback_('📍 地点を足す', 'a=add')]);
  const cache = CacheService.getScriptCache();
  const key = `REQUEST_${userId}`;
  if (cache.get(key)) return textMessage_('持ち主に伝えてあります。許されたら、ここに知らせが届きます。');
  cache.put(key, '1', MEMBER_REQUEST_SECONDS_);

  const name = displayNameOf_(userId) || '（名前を読めませんでした）';
  const row = memberRow_(userId);
  if (row) updateRow_('members', 'userId', userId, { displayName: name, status: 'requested' });
  else appendRow_('members', { userId: userId, displayName: name, status: 'requested', createdAt: new Date(), updatedAt: new Date() });

  const sent = push_(owner, [textMessage_(
    `🙋 ${name}さんが、天気の知らせを使いたいそうです。許すと、地点を足せるようになります（1人${NOTICE_MAX_PER_PERSON_}か所まで）。`,
    [
      postback_('✅ 許す', `a=allow&u=${encodeURIComponent(userId)}`, `✅ ${name}さんを許す`),
      postback_('やめておく', `a=deny&u=${encodeURIComponent(userId)}`, `${name}さんはやめておく`)
    ]
  )]);
  return textMessage_(sent ? '持ち主に伝えました。許されたら、ここに知らせが届きます。' : '持ち主に伝えられませんでした。少しあとで、もう一度押してね。');
}

/** 持ち主が「✅ 許す」「やめておく」「🚫 やめさせる」を押したとき */
function memberDecisionReply_(action, userId) {
  const row = userId ? memberRow_(userId) : null;
  if (!row) return textMessage_('この人は見つかりませんでした（もう決めたかもしれません）。', [postback_('👥 使う人', 'a=members')]);
  const name = cleanText_(row.displayName, 30) || '（名前なし）';
  const status = String(row.status).trim();
  if (action === 'allow') {
    if (status === 'allowed') return textMessage_(`${name}さんは、もう使えます。`, [postback_('👥 使う人', 'a=members')]);
    updateRow_('members', 'userId', userId, { status: 'allowed' });
    push_(userId, [textMessage_(QSeason.decorate('✅ 持ち主が許してくれました。地点を足すと、知らせることがある日だけ届きます。'), [postback_('📍 地点を足す', 'a=add')])]);
    return textMessage_(`✅ ${name}さんを許しました。`, [postback_('👥 使う人', 'a=members')]);
  }
  if (action === 'deny') {
    if (status === 'allowed') return textMessage_(`${name}さんは、もう許しています。やめさせるときは「👥 使う人」から。`, [postback_('👥 使う人', 'a=members')]);
    updateRow_('members', 'userId', userId, { status: 'denied' });
    return textMessage_(`${name}さんは、やめておきました（相手には知らせません）。`);
  }
  // unallow：やめさせる。その人が足した地点の知らせも止める
  if (status !== 'allowed') return textMessage_(`${name}さんは、もう使えないようになっています。`, [postback_('👥 使う人', 'a=members')]);
  updateRow_('members', 'userId', userId, { status: 'removed' });
  activeNotices_().filter((n) => n.ownerUserId === userId).forEach((n) => updateRow_('notices', 'noticeId', n.noticeId, { isActive: false }));
  return textMessage_(`🚫 ${name}さんをやめさせました（足した地点の知らせも止めました）。`, [postback_('👥 使う人', 'a=members')]);
}

function membersForCard_() {
  return readRows_('members').map((row) => ({
    userId: String(row.userId || '').trim(),
    displayName: cleanText_(row.displayName, 30),
    status: String(row.status || '').trim()
  })).filter((m) => m.userId);
}
