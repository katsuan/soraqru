/**
 * 8_test_window.gs：持ち主のテストの窓口「#テスト」（ux.md の H11）
 * 持ち主が1対1 で「#テスト」と送ると 🧪 のカード。押すだけで、返事の見本・自己点検・断られたときの文・季節の絵文字を見られる。
 * 見本はためしの予報で作り、すべて 🧪 付き。シートには書かない。返事（reply）だけで、push は使わない。
 */

function buildTestWindowCard_() {
  const card = {
    type: 'flex',
    altText: '🧪 テストの窓口：返事の見本・自己点検・断られたときの文・季節の絵文字',
    contents: {
      type: 'bubble',
      header: header_('🧪 テストの窓口', `${BOT_NAME_}（版 ${BOT_VERSION_}）`),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '下のボタンで、見本を返します（ためしの予報。シートには書かず、push もしません）。', size: 'sm', wrap: true },
          smallText_('📨 知らせの見本・📋 一覧の見本・🩺 自己点検・🧯 カードが断られたときの文・🎃 季節の絵文字（出る／出ない）')
        ]
      },
      footer: footer_([postbackButton_('📨 知らせの見本', 'a=test&t=notice'), postbackButton_('🩺 自己点検', 'a=test&t=check')])
    }
  };
  return withQuickReply_(card, testQuickReply_());
}

function testQuickReply_() {
  return [
    postback_('📨 知らせの見本', 'a=test&t=notice'),
    postback_('📋 一覧の見本', 'a=test&t=list'),
    postback_('🩺 自己点検', 'a=test&t=check'),
    postback_('🧯 断られたとき', 'a=test&t=fallback'),
    postback_('🎃 季節の絵文字あり', 'a=test&t=season_on'),
    postback_('🍂 季節の絵文字なし', 'a=test&t=season_off')
  ];
}

function testWindowReply_(event, kind) {
  const quick = testQuickReply_();
  const last = (messages) => {
    withQuickReply_(messages[messages.length - 1], quick);
    return messages;
  };
  switch (kind) {
    case 'notice':
      return last(buildSampleNoticeCards_());
    case 'list': {
      const sample = [
        { noticeId: 'sample1', placeName: '名古屋市中村区', lat: 35.17, lon: 136.88, notifyHour: 7 },
        { noticeId: 'sample2', placeName: '札幌市中央区', lat: 43.06, lon: 141.35, notifyHour: 21 }
      ];
      return last([
        buildListCard_(sample, 'owner', { sample: true }),
        buildMembersCard_([{ userId: 'Usample', displayName: 'ためしの人', status: 'allowed' }], { sample: true }),
        textMessage_('🧪 ここまでが、一覧と「👥 使う人」の見本です。')
      ]);
    }
    case 'check':
      return last([textMessage_(`🧪 自己点検\n${selfCheckSummary_()}`)]);
    case 'fallback':
      return last([textMessage_(`🧪 ${fallbackText_([buildSampleNoticeCards_()[0]])}`)]);
    case 'season_on':
      return last([textMessage_(`🧪 ${QSeason.decorate('📍 名古屋市中村区 を登録しました。', { rand: () => 0 })}`)]);
    case 'season_off':
      return last([textMessage_(`🧪 ${QSeason.decorate('📍 名古屋市中村区 を登録しました。', { rand: () => 0.999 })}`)]);
    default:
      return [buildTestWindowCard_()];
  }
}

/** 知らせの見本（雨・気圧・気温の3枚と、何もない日の文）。ためしの予報で作る */
function buildSampleNoticeCards_() {
  const now = new Date();
  const notice = { placeName: '名古屋市中村区', lat: 35.17, lon: 136.88 };
  const today = formatDay_(now);
  const yesterday = formatDay_(new Date(now.getTime() - 24 * 3600 * 1000));
  const make = (o) => {
    const time = [];
    const pressure = [];
    const pop = [];
    const temp = [];
    [yesterday, today].forEach((date, dayIndex) => {
      for (let hour = 0; hour < 24; hour += 1) {
        time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
        pressure.push(1013 - (dayIndex && o.pressureDrop && hour >= 12 ? (hour - 11) * o.pressureDrop : 0));
        pop.push(dayIndex && o.rain && hour >= 12 && hour <= 14 ? 70 : 10);
        temp.push(dayIndex ? 18 + (o.tempJump || 0) : 18);
      }
    });
    return parseForecast_({
      hourly: { time: time, pressure_msl: pressure, precipitation_probability: pop, temperature_2m: temp },
      daily: { time: [yesterday, today], temperature_2m_max: [18, 18 + (o.tempJump || 0)] }
    });
  };
  const cards = [{ rain: true }, { pressureDrop: 1.2 }, { tempJump: -7 }]
    .map((o) => buildNoticeCard_(notice, today, evaluateNotice_(make(o), today), { now: now, sample: true }));
  const calm = evaluateNotice_(make({}), today);
  return [...cards, textMessage_(calm.length ? '🧪（何もない日の見本を作れませんでした）' : '🧪 何もない日（雨・気圧・気温どれもふつう）は、送りません。')];
}

/** qCheckAll の結果を、トークで読める短さに */
function selfCheckSummary_() {
  const out = qCheckAll();
  const count = { '✅': 0, '⚠️': 0, '❌': 0 };
  out.results.forEach((r) => (count[r.level] = (count[r.level] || 0) + 1));
  const bad = out.results.filter((r) => r.level !== '✅').slice(0, 8).map((r) => `${r.level} ${r.area}：${r.text}`);
  return [`✅ ${count['✅']}　⚠️ ${count['⚠️']}　❌ ${count['❌']}`, ...bad].join('\n').slice(0, 1500);
}
