/**
 * そらくる 天気の知らせボット（配布用シートのコピーで、だれでも自分のボットとして持てる）
 * 1_config.gs：決まった値・設定の読み方・役割の分け方
 *
 * 役割（3つに分ける）
 *   システム管理者 … このシートと GAS を持っている人（コピーした人）。GAS エディタで 0_setup の関数を動かす・鍵を入れる
 *   ツール管理者   … 持ち主（OWNER_USER_ID）。LINE で「#持ち主」と送り、システム管理者が adoptOwner を実行して決める。
 *                    使う人を許す・やめさせる、#テスト を使える
 *   ユーザー       … 持ち主が許した人（シート「使う人」）。地点を足す・時間をかえる・やめる
 * 許していない人が友だちになっても、知らせは送らない（push の無料枠を、知らない人に使わせない）
 *
 * スクリプト プロパティ（配布用シートでは空。鍵が人に渡らないように）
 *   LINE_CHANNEL_ACCESS_TOKEN … 自分のチャネルの長期のチャネルアクセストークン（システム管理者が入れる）
 *   WEBHOOK_KEY               … Webhook の URL の ?key=（setupBot が作る。LINE の署名を GAS では読めないため）
 *   OWNER_USER_ID             … 持ち主の LINE の ID（adoptOwner が入れる）
 */

const BOT_VERSION_ = '2026.10.25';
const BOT_NAME_ = 'そらくる 天気の知らせ';
const BOT_COLOR_ = '#3A56D6'; // そらくるのロゴの群青

const NOTICE_LABEL_ = '🌦️ 天気の知らせ';
const NOTICE_MAX_PER_PERSON_ = 3;
const NOTICE_MAX_TOTAL_ = 20; // 1つのボットで見る地点の数（Open-Meteo の無料枠と push の無料枠のため）
const NOTICE_HOURS_ = [6, 7, 8, 21];
const NOTICE_DEFAULT_HOUR_ = 7;
const NOTICE_EVENING_FROM_ = 18; // この時間からの知らせは、明日のぶん
const NOTICE_QUOTA_RATE_ = 0.8; // 今月の push がこの割合をこえたら、知らせは送らない
const NOTICE_PENDING_SECONDS_ = 600; // 「📍 地点を足す」から位置情報を受けとる時間
const NOTICE_RULES_ = {
  rainPop: 60,
  rainFromHour: 6,
  rainToHour: 21,
  pressureLevel: 2, // そらくるの目安で「注意」から
  tempDiff: 5
};
const MEMBER_REQUEST_SECONDS_ = 24 * 3600; // 「🙋 使いたい」は1人1日1回だけ持ち主に知らせる
const OWNER_CANDIDATE_SECONDS_ = 600;

const SORAQRU_URL_ = 'https://katsuan.github.io/soraqru/';
const SORAQRU_MUNI_URL_ = 'https://katsuan.github.io/soraqru/data/muni.json';
const RICH_MENU_IMAGE_URL_ = 'https://katsuan.github.io/soraqru/gas/richmenu.png';
const OPEN_METEO_URL_ = 'https://api.open-meteo.com/v1/forecast';
const GSI_REVERSE_GEOCODER_URL_ = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const NOTICE_SOURCE_TEXT_ = '天気：Open-Meteo.com（CC BY 4.0）・地名：国土地理院・気圧は変化の目安です（体調の予測ではありません）';

const SHEETS_ = {
  notices: { name: '地点', headers: ['noticeId', 'ownerUserId', 'targetType', 'targetId', 'placeName', 'lat', 'lon', 'notifyHour', 'isActive', 'lastCheckedDate', 'createdAt', 'updatedAt'] },
  members: { name: '使う人', headers: ['userId', 'displayName', 'status', 'createdAt', 'updatedAt'] },
  log: { name: '動作の記録', headers: ['at', 'step', 'summary'] }
};

const prop_ = PropertiesService.getScriptProperties();

function propText_(key) {
  return String(prop_.getProperty(key) || '').trim();
}

function lineToken_() {
  return propText_('LINE_CHANNEL_ACCESS_TOKEN');
}

function ownerUserId_() {
  return propText_('OWNER_USER_ID');
}

function timeZone_() {
  return Session.getScriptTimeZone() || 'Asia/Tokyo';
}

function formatDay_(date) {
  return Utilities.formatDate(date, timeZone_(), 'yyyy-MM-dd');
}

// 1回の呼び出しの中で、同じシートは1回だけ読む（ux.md の H9）
const memo_ = {};

/** その人の役割：'owner'（持ち主）・'member'（許した人）・''（どちらでもない） */
function roleOf_(userId) {
  const id = String(userId || '').trim();
  if (!id) return '';
  if (id === ownerUserId_()) return 'owner';
  return allowedMemberIds_().includes(id) ? 'member' : '';
}

function canUse_(userId) {
  return Boolean(roleOf_(userId));
}

// qCheckAll（99_selfcheck.gs）で確かめるもの
var Q_SELF_CHECK = {
  properties: ['LINE_CHANNEL_ACCESS_TOKEN', 'WEBHOOK_KEY', 'OWNER_USER_ID'],
  secretProperties: ['LINE_CHANNEL_ACCESS_TOKEN', 'WEBHOOK_KEY'],
  // spreadsheetId は書かない（この GAS がついているシートを読む。ほかのシートを開く許可を求めないため）
  sheets: {
    '地点': SHEETS_.notices.headers,
    '使う人': SHEETS_.members.headers,
    '動作の記録': SHEETS_.log.headers
  },
  lineTokenProperty: 'LINE_CHANNEL_ACCESS_TOKEN',
  cards: function () { return buildSampleNoticeCards_().slice(0, 3); },
  richMenus: true,
  triggers: ['hourlyWeatherNotice'],
  heartbeats: { hourlyWeatherNotice: 130 }
};
