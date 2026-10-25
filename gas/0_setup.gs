/**
 * 0_setup.gs：このシートを持っている人（システム管理者）が、GAS エディタで実行する関数
 * 上の「実行する関数を選ぶ」から選んで ▶ 実行。結果は下の「実行ログ」に出ます。
 *
 *   setupBot        … はじめに1回：シートを作り、Webhook の合言葉と1時間おきの見張り（トリガー）を用意する
 *   showWebhookUrl  … デプロイしたあと：LINE に入れる Webhook の URL を出す
 *   adoptOwner      … LINE で「🔑 持ち主の登録」を押してから10分以内：押した人を持ち主にする
 *   setupRichMenu   … LINE のトークの下のメニュー（天気の知らせ・地点を足す・そらくる）を作る
 *   checkBot        … 準備ができているかを見る（何も書きかえない・送らない）
 *
 * くわしい手順：https://katsuan.github.io/soraqru/docs/notify-setup.html
 */

function setupBot() {
  Object.keys(SHEETS_).forEach((kind) => sheet_(kind));
  if (!propText_('WEBHOOK_KEY')) {
    prop_.setProperty('WEBHOOK_KEY', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    console.log('✅ Webhook の合言葉（WEBHOOK_KEY）を作りました');
  } else {
    console.log('✅ Webhook の合言葉（WEBHOOK_KEY）はもうあります');
  }
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction && t.getHandlerFunction() === 'hourlyWeatherNotice');
  if (!has) {
    ScriptApp.newTrigger('hourlyWeatherNotice').timeBased().everyHours(1).create();
    console.log('✅ 1時間おきの見張り（hourlyWeatherNotice）を作りました');
  } else {
    console.log('✅ 1時間おきの見張りはもうあります');
  }
  if (!lineToken_()) {
    console.log('⚠️ LINE_CHANNEL_ACCESS_TOKEN がまだです：「プロジェクトの設定」→「スクリプト プロパティ」に入れてね');
  }
  console.log('次は：「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行するユーザー：自分、アクセスできるユーザー：全員）→ showWebhookUrl を実行');
  return true;
}

function showWebhookUrl() {
  const key = propText_('WEBHOOK_KEY');
  if (!key) {
    console.log('❌ 先に setupBot を実行してね');
    return '';
  }
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (error) {
    url = '';
  }
  if (!/\/exec$/.test(url)) {
    console.log('❌ まだデプロイされていません：「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」で、アクセスできるユーザーを「全員」にしてね');
    console.log(`（デプロイしたあとの URL の最後に ?key=${key} を付けたものが Webhook の URL です）`);
    return '';
  }
  const webhook = `${url}?key=${key}`;
  console.log('この URL を、LINE Developers の「Messaging API設定」→「Webhook URL」に入れてね（人に見せない）');
  console.log(webhook);
  return webhook;
}

function adoptOwner() {
  const raw = prop_.getProperty(OWNER_CANDIDATE_PROP_);
  prop_.deleteProperty(OWNER_CANDIDATE_PROP_);
  let candidate = null;
  try {
    candidate = JSON.parse(raw || 'null');
  } catch (error) {
    candidate = null;
  }
  if (!candidate || !candidate.userId || Date.now() - Number(candidate.at || 0) > OWNER_CANDIDATE_SECONDS_ * 1000) {
    console.log('❌ 候補がないか、古くなっています。LINE で「🔑 持ち主の登録」を押してから、10分以内に実行してね');
    return false;
  }
  const name = displayNameOf_(candidate.userId);
  prop_.setProperty('OWNER_USER_ID', candidate.userId);
  console.log(`✅ 持ち主を「${name || '（名前を読めませんでした）'}」（${maskId_(candidate.userId)}）にしました。ちがう人なら、もう一度やりなおしてね`);
  return true;
}

/** トークの下のメニュー（3つ）。前に作ったものは消して作りなおす */
function setupRichMenu() {
  if (!lineToken_()) {
    console.log('❌ LINE_CHANNEL_ACCESS_TOKEN がまだです');
    return false;
  }
  const area = (x, action) => ({ bounds: { x: x, y: 0, width: 833, height: 843 }, action: action });
  const menu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'soraqru-notice',
    chatBarText: '🌦️ 天気の知らせ',
    areas: [
      area(0, { type: 'postback', data: 'a=menu', displayText: NOTICE_LABEL_ }),
      area(833, { type: 'postback', data: 'a=add', displayText: '📍 地点を足す' }),
      area(1666, { type: 'uri', uri: SORAQRU_URL_ })
    ]
  };
  const created = lineRequest_('post', 'richmenu', menu);
  if (created.getResponseCode() !== 200) {
    console.log(`❌ メニューを作れませんでした（${created.getResponseCode()}）`);
    return false;
  }
  const id = JSON.parse(created.getContentText()).richMenuId;
  const image = UrlFetchApp.fetch(RICH_MENU_IMAGE_URL_, { muteHttpExceptions: true });
  if (image.getResponseCode() !== 200) {
    console.log('❌ メニューの画像を読めませんでした（少しあとで、もう一度）');
    return false;
  }
  const upload = UrlFetchApp.fetch(`${LINE_DATA_API_}/richmenu/${id}/content`, {
    method: 'post',
    contentType: 'image/png',
    headers: { Authorization: `Bearer ${lineToken_()}` },
    payload: image.getBlob().getBytes(),
    muteHttpExceptions: true
  });
  if (upload.getResponseCode() !== 200) {
    console.log(`❌ メニューの画像を送れませんでした（${upload.getResponseCode()}）`);
    return false;
  }
  lineRequest_('post', `user/all/richmenu/${id}`);
  const old = propText_('RICH_MENU_ID');
  if (old && old !== id) lineRequest_('delete', `richmenu/${old}`);
  prop_.setProperty('RICH_MENU_ID', id);
  console.log('✅ トークの下のメニューを作りました（出るまで少しかかることがあります）');
  return true;
}

/** 準備ができているか（何も書きかえない・送らない） */
function checkBot() {
  console.log(`${BOT_NAME_}（版 ${BOT_VERSION_}）`);
  const owner = ownerUserId_();
  if (owner) {
    const name = displayNameOf_(owner);
    console.log(name ? `✅ 持ち主は「${name}」（${maskId_(owner)}）` : `❌ 持ち主（${maskId_(owner)}）が、このボットの友だちの ID ではありません（チャネルを変えた？）。もう一度「🔑 持ち主の登録」`);
  } else {
    console.log('❌ 持ち主がまだです：LINE で「🔑 持ち主の登録」を押し、10分以内に adoptOwner を実行');
  }
  const key = propText_('WEBHOOK_KEY');
  if (key && key.length < 24) console.log('⚠️ WEBHOOK_KEY が短い（24字以上に。setupBot で作りなおすなら、消してから実行）');
  console.log(`地点：${activeNotices_().length}か所・使う人：${allowedMemberIds_().length}人`);
  return qCheckAll();
}

/** ID は頭と終わりだけ出す */
function maskId_(id) {
  const s = String(id || '');
  return s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-4)}` : '…';
}
