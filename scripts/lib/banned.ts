/**
 * 演示案例中不得出现的真实平台名称（AGENTS.md §3），供 validate:cases 检查案例中的全部字符串值。
 * 只收平台名，不收城市、场馆、交通方式等通用词。
 * 由 ASCII 字符组成的名称不区分大小写、按整词匹配（PayMe 不命中 PAYMENT）；中文名称按子串匹配。
 */
export const BANNED_PLATFORM_NAMES: readonly string[] = [
  // 票务
  '大麦',
  '猫眼',
  '票星球',
  '秀动',
  '摩天轮票务',
  '永乐票务',
  '聚橙',
  '纷玩岛',
  '城市售票网',
  '快达票',
  'Damai',
  'Maoyan',
  'Ticketmaster',
  'Cityline',
  'URBTIX',
  'HK Ticketing',
  'KKTIX',
  // 出行与住宿；“去哪儿”“同程”“滴滴”是常用词，只收全称
  '携程',
  '去哪儿网',
  '飞猪',
  '同程旅行',
  '艺龙',
  '途牛',
  '马蜂窝',
  '美团',
  '大众点评',
  '12306',
  '航旅纵横',
  '滴滴出行',
  '高德地图',
  '花小猪',
  '爱彼迎',
  'Ctrip',
  'Trip.com',
  'Qunar',
  'Fliggy',
  'Meituan',
  'Dianping',
  'DiDi',
  'Booking.com',
  'Agoda',
  'Airbnb',
  'Expedia',
  'Klook',
  'KKday',
  'Uber',
  // 电商、内容与支付
  '淘宝',
  '天猫',
  '京东',
  '拼多多',
  '闲鱼',
  '抖音',
  '小红书',
  '饿了么',
  '微信',
  '支付宝',
  '云闪付',
  '八达通',
  '转数快',
  'Taobao',
  'Tmall',
  'JD.com',
  'Pinduoduo',
  'Alipay',
  'AlipayHK',
  'WeChat',
  'WeChatPay',
  'UnionPay',
  'PayMe',
  'Octopus',
]

// SPEC-GAP SG-34：含禁用词但不是平台名称的地名（南京东路、北京东站等），匹配前先去掉
const ALLOWED_PHRASES: readonly string[] = ['南京东', '北京东']

const ASCII_NAME = /^[\x20-\x7E]+$/

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const MATCHERS = BANNED_PLATFORM_NAMES.map((name) => {
  if (!ASCII_NAME.test(name)) return { name, test: (text: string) => text.includes(name) }
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'i')
  return { name, test: (text: string) => pattern.test(text) }
})

/** 返回 text 中出现的真实平台名称，按 BANNED_PLATFORM_NAMES 的顺序 */
export function findBannedNames(text: string): string[] {
  let rest = text
  for (const phrase of ALLOWED_PHRASES) rest = rest.replaceAll(phrase, ' ')
  return MATCHERS.filter((matcher) => matcher.test(rest)).map((matcher) => matcher.name)
}
