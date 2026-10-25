/**
 * 4_cards.gs：カード（Flex Message）
 * 形は ux.md の H2：色の帯（小さく日付・区分、太く見出し）→ 中身（大事なことを先に）→ 行動のボタン（2つまで）。
 * カードのボタンは、あとで押されても困らないものだけ（URL を開く・聞き返す）。1回きりの操作はクイックリプライ。
 */

const WEEK_ = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-10-26" → "10/26（月）" */
function dayLabel_(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK_[d.getUTCDay()]}）`;
}

function header_(title, sub) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: BOT_COLOR_,
    paddingAll: '14px',
    contents: [
      { type: 'text', text: sub || BOT_NAME_, size: 'xs', color: '#FFFFFF', wrap: true },
      { type: 'text', text: title, size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true, margin: 'xs' }
    ]
  };
}

function smallText_(text, options) {
  return Object.assign({ type: 'text', text: text, size: 'xs', color: '#6B7280', wrap: true }, options || {});
}

function uriButton_(label, uri, style) {
  return { type: 'button', style: style || 'primary', color: style === 'secondary' ? undefined : BOT_COLOR_, height: 'sm', action: { type: 'uri', label: label, uri: uri } };
}

function postbackButton_(label, data) {
  return { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: label, data: data, displayText: label } };
}

function cleanButton_(button) {
  if (button.color === undefined) delete button.color;
  return button;
}

function footer_(buttons) {
  return { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: buttons.slice(0, 2).map(cleanButton_) };
}

/** その地点が開くそらくるのリンク */
function soraqruPlaceUrl_(notice) {
  const at = `${Number(notice.lat).toFixed(2)},${Number(notice.lon).toFixed(2)}`;
  return `${SORAQRU_URL_}?at=${at}&name=${encodeURIComponent(notice.placeName || '')}&from=bot`;
}

// ---- 知らせのカード ----

/** altText は「☔ 名古屋市中村区：12〜15時 雨 70%（ほか1つ）」のように中身がわかる1行 */
function buildNoticeCard_(notice, date, alerts, options) {
  const opt = options || {};
  const isTomorrow = date !== formatDay_(opt.now || new Date());
  const first = alerts[0];
  const more = alerts.length > 1 ? `（ほか${alerts.length - 1}つ）` : '';
  const mark = opt.sample ? '🧪 ' : '';
  return {
    type: 'flex',
    altText: `${mark}${first.emoji} ${notice.placeName}：${first.lines[0]}${more}`.slice(0, 400),
    contents: {
      type: 'bubble',
      header: header_(`${mark}🌦️ ${notice.placeName}`, `${dayLabel_(date)}　${isTomorrow ? '明日の天気の知らせ' : '今日の天気の知らせ'}`),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'lg',
        contents: [...alerts.map(alertRow_), smallText_(NOTICE_SOURCE_TEXT_, { size: 'xxs', color: '#9CA3AF', margin: 'lg' })]
      },
      footer: footer_([uriButton_('🌤️ そらくるで開く', soraqruPlaceUrl_(notice), 'secondary')])
    }
  };
}

// 1つの知らせ：絵文字・題・時間帯は1つずつの行（トークで読みやすいように）
function alertRow_(alert) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      { type: 'text', text: alert.emoji, size: 'xl', flex: 0, gravity: 'top' },
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          smallText_(alert.title),
          ...alert.lines.map((line) => ({ type: 'text', text: line, size: 'md', weight: 'bold', color: '#111827', wrap: true }))
        ]
      }
    ]
  };
}

// ---- 一覧（「🌦️ 天気の知らせ」・リッチメニュー） ----

function formatHour_(hour) {
  return Number(hour) >= NOTICE_EVENING_FROM_ ? `前の日の${hour}時（明日のぶん）` : `毎朝${hour}時`;
}

function buildListCard_(notices, role, options) {
  const opt = options || {};
  const mark = opt.sample ? '🧪 ' : '';
  const rows = notices.length
    ? notices.map((n) => ({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        { type: 'text', text: `📍 ${n.placeName}`, size: 'sm', weight: 'bold', wrap: true, flex: 3 },
        { type: 'text', text: formatHour_(n.notifyHour), size: 'xs', color: '#6B7280', align: 'end', wrap: true, flex: 2 }
      ]
    }))
    : [smallText_('まだ地点はありません', { size: 'sm' })];
  const canEdit = Boolean(role);
  const card = {
    type: 'flex',
    altText: `${mark}🌦️ 天気の知らせ：${notices.length ? notices.map((n) => n.placeName).join('・') : 'まだ地点はありません'}`.slice(0, 400),
    contents: {
      type: 'bubble',
      header: header_(`${mark}${NOTICE_LABEL_}`, 'このトークに送る地点'),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          smallText_(`雨・気圧の変化・気温の大きな変わり目がある日だけ、決めた時間に送ります（1人${NOTICE_MAX_PER_PERSON_}か所まで）。`, { color: '#4B5563' }),
          ...rows,
          canEdit ? null : smallText_('地点を足すには、このボットの持ち主の許可が要ります。')
        ].filter(Boolean)
      }
    }
  };
  // ボタンは聞き返すだけ（あとで押されても困らない）
  if (canEdit) {
    card.contents.footer = footer_([
      postbackButton_('📍 地点を足す', 'a=add'),
      notices.length ? postbackButton_('⚙️ 時間・やめる', 'a=edit') : null
    ].filter(Boolean));
  }
  return withQuickReply_(card, listQuickReply_(notices, role));
}

function listQuickReply_(notices, role) {
  if (!role) return [postback_('🙋 使いたいと伝える', 'a=request')];
  return [
    postback_('📍 地点を足す', 'a=add'),
    notices.length ? postback_('⏰ 時間をかえる', 'a=pick&m=time') : null,
    notices.length ? postback_('🗑️ やめる地点', 'a=pick&m=remove') : null,
    role === 'owner' ? postback_('👥 使う人', 'a=members') : null,
    { type: 'uri', label: '🌤️ そらくる', uri: SORAQRU_URL_ }
  ].filter(Boolean);
}

// ---- 使う人（持ち主だけ） ----

function buildMembersCard_(members, options) {
  const opt = options || {};
  const mark = opt.sample ? '🧪 ' : '';
  const allowed = members.filter((m) => m.status === 'allowed');
  const card = {
    type: 'flex',
    altText: `${mark}👥 使う人：${allowed.length ? allowed.map((m) => m.displayName || '（名前なし）').join('・') : 'まだいません'}`.slice(0, 400),
    contents: {
      type: 'bubble',
      header: header_(`${mark}👥 使う人`, '持ち主が許した人'),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'sm',
        contents: [
          smallText_('このボットの友だちになった人が「🙋 使いたいと伝える」を押すと、持ち主に知らせが届きます。許した人だけが地点を足せます。', { color: '#4B5563' }),
          ...(allowed.length
            ? allowed.map((m) => ({ type: 'text', text: `🙂 ${m.displayName || '（名前なし）'}`, size: 'sm', weight: 'bold', wrap: true }))
            : [smallText_('まだいません（持ち主だけが使えます）', { size: 'sm' })])
        ]
      }
    }
  };
  // やめさせるのは1回きりの操作なので、クイックリプライだけ
  return withQuickReply_(card, allowed.slice(0, 12).map((m) => postback_(`🚫 ${m.displayName || '名前なし'}`, `a=unallow&u=${encodeURIComponent(m.userId)}`, `🚫 ${m.displayName || '名前なし'}さんをやめさせる`)).concat([postback_(NOTICE_LABEL_, 'a=menu')]));
}

// ---- はじめのあいさつ（友だちになったとき） ----

function buildWelcomeCard_(role, hasOwner) {
  const lines = [
    '雨・気圧の変化・気温の大きな変わり目がある日だけ、決めた時間に知らせます。',
    '気圧の目安は、そらくると同じ見方です。'
  ];
  const card = {
    type: 'flex',
    altText: `${BOT_NAME_}：地点を足すと、知らせることがある日だけ届きます`,
    contents: {
      type: 'bubble',
      header: header_('🌤️ ようこそ', BOT_NAME_),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          ...lines.map((t) => ({ type: 'text', text: t, size: 'sm', wrap: true })),
          role
            ? smallText_('下のボタンか、メニューの「📍 地点を足す」から始められます。')
            : smallText_(hasOwner ? 'このボットは、持ち主が許した人だけが使えます。「🙋 使いたいと伝える」を押すと、持ち主に届きます。' : 'まだ持ち主が決まっていません。このボットを作った人は「🔑 持ち主の登録」を押してね。'),
          smallText_(NOTICE_SOURCE_TEXT_, { size: 'xxs', color: '#9CA3AF' })
        ]
      },
      footer: footer_([role ? postbackButton_('📍 地点を足す', 'a=add') : postbackButton_(NOTICE_LABEL_, 'a=menu')])
    }
  };
  const quick = role
    ? [postback_('📍 地点を足す', 'a=add'), postback_(NOTICE_LABEL_, 'a=menu')]
    : hasOwner
      ? [postback_('🙋 使いたいと伝える', 'a=request')]
      : [postback_('🔑 持ち主の登録', 'a=owner')];
  return withQuickReply_(card, quick);
}
