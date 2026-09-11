import {
  DAY_HOURS,
  GENERIC_MAIL_TEMPLATES,
  INITIAL_MAILS,
  ISLANDS,
  ISLAND_MAP,
  MAX_HOUR,
  ROUTES,
  UPGRADES,
  neighborsOf,
  otherEnd,
  routeBetween
} from './data';
import type {
  GameState,
  Island,
  IslandId,
  LogEntry,
  Mail,
  Route,
  Secrecy,
  TravelMode,
  Weather
} from './types';

export const SAVE_KEY = 'tidal-post-office-save-v1';

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dayOf(hour: number): number {
  return Math.floor(hour / DAY_HOURS) + 1;
}

export function clockOf(hour: number): string {
  const h = ((hour % DAY_HOURS) + DAY_HOURS) % DAY_HOURS;
  const hh = String(Math.floor(h)).padStart(2, '0');
  const mm = h % 1 === 0 ? '00' : String(Math.round((h % 1) * 60)).padStart(2, '0');
  return `第${dayOf(hour)}日 ${hh}:${mm}`;
}

export function tideAt(hour: number, weather: Weather = 'clear'): number {
  const phase = ((hour % 12) + 12) % 12;
  const raw = 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / 12);
  if (weather === 'storm') return clamp(raw + 0.12, 0, 1);
  if (weather === 'fog') return clamp(raw - 0.03, 0, 1);
  return raw;
}

export function tideLabel(value: number): string {
  if (value < 0.2) return '低潮';
  if (value < 0.4) return '落潮';
  if (value < 0.65) return '平潮';
  if (value < 0.85) return '涨潮';
  return '高潮';
}

export function tideWord(value: number): string {
  return value.toFixed(2);
}

function routeVector(route: Route, from: IslandId): { x: number; y: number } {
  const a = ISLAND_MAP[from];
  const b = ISLAND_MAP[otherEnd(route, from)];
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

function currentVector(hour: number): { x: number; y: number } {
  const strength = 0.75 + 0.25 * Math.sin((2 * Math.PI * hour) / 24);
  const angle = -Math.PI / 4 + (Math.PI / 2) * Math.sin((2 * Math.PI * hour) / 12);
  return { x: Math.cos(angle) * strength, y: Math.sin(angle) * strength };
}

export function currentScore(hour: number, route: Route, from: IslandId, weather: Weather = 'clear'): number {
  const v = routeVector(route, from);
  const c = currentVector(hour);
  const dot = v.x * c.x + v.y * c.y;
  let score = route.current * dot;
  if (weather === 'storm') score *= 0.65;
  if (weather === 'fog') score *= 0.75;
  return score;
}

export function shallowOpen(hour: number, weather: Weather = 'clear'): boolean {
  return tideAt(hour, weather) >= 0.35;
}

export function canSeeRoute(state: GameState, route: Route): boolean {
  return !route.hidden || state.tools.spyglass || Boolean(state.flags.hiddenChartKnown);
}

export function cargoUsed(state: GameState): number {
  // Math.max(0, ...) 是纵深防御：正常数据重量恒正，校验也拒绝负值/非整数。
  return state.mails.filter((m) => m.status === 'accepted').reduce((sum, m) => sum + Math.max(0, m.weight), 0);
}

export function cargoMax(state: GameState): number {
  return 8 + state.upgrades.cargo * 3;
}

export function fuelMax(state: GameState): number {
  return 24 + state.upgrades.tank * 8;
}

export function sailSpeed(state: GameState, hour: number, route: Route, from: IslandId, weather: Weather): number {
  const tide = tideAt(hour, weather);
  const current = currentScore(hour, route, from, weather);
  let speed = 2.4 + tide * 1.9 + current;
  if (route.shallow) speed += tide >= 0.8 ? 0.4 : tide < 0.35 ? -0.4 : 0;
  if (weather === 'storm') speed *= 0.72;
  if (weather === 'fog') speed *= 0.86;
  return Math.max(0.25, speed);
}

export function motorSpeed(state: GameState, hour: number, route: Route, from: IslandId, weather: Weather): number {
  const tide = tideAt(hour, weather);
  const current = currentScore(hour, route, from, weather);
  let speed = 4.1 + state.upgrades.engine * 1.0 + (tide - 0.5) * 1.35 + current * 0.65;
  if (weather === 'storm') speed *= 0.88;
  if (weather === 'fog') speed *= 0.92;
  return Math.max(0.8, speed);
}

export interface VoyageEstimate {
  hours: number;
  fuel: number;
  blocked: string;
  minTide: number;
  avgTide: number;
  openWindows: number;
}

export function estimateVoyage(state: GameState, route: Route, from: IslandId, mode: TravelMode, weather: Weather = 'clear'): VoyageEstimate {
  if (route.hidden && !canSeeRoute(state, route)) {
    return { hours: 0, fuel: 0, blocked: '暗礁航线未在海图上：需要铜望远镜或海图线索。', minTide: 0, avgTide: 0, openWindows: 0 };
  }

  let hour = state.hour;
  let progress = 0;
  let fuel = 0;
  let tideSum = 0;
  let minTide = 1;
  let openWindows = 0;
  const maxSim = 48;

  for (let steps = 0; steps < maxSim * 2 && progress < route.distance; steps += 1) {
    const half = 0.5;
    if (route.shallow && !shallowOpen(hour, weather)) {
      if (mode === 'sail') {
        hour += half;
        continue;
      }
      // 机帆船可以硬推过浅滩，但航速极低、船底有刮擦风险。
      progress += 0.35 * half;
      fuel += (1.25 + state.upgrades.engine * 0.25) * half;
      hour += half;
      const lowTide = tideAt(hour, weather);
      tideSum += lowTide;
      minTide = Math.min(minTide, lowTide);
      continue;
    }
    if (route.shallow && shallowOpen(hour, weather)) openWindows += 1;
    const speed = mode === 'sail'
      ? sailSpeed(state, hour, route, from, weather)
      : motorSpeed(state, hour, route, from, weather);
    progress += speed * half;
    if (mode === 'motor') fuel += (1.25 + state.upgrades.engine * 0.25) * half;
    const t = tideAt(hour, weather);
    tideSum += t;
    minTide = Math.min(minTide, t);
    hour += half;
  }

  const hours = Math.ceil((hour - state.hour) * 2) / 2;
  const avgTide = tideSum / Math.max(1, hours * 2);
  let blocked = '';
  if (route.shallow && openWindows === 0 && mode === 'sail') blocked = '未来数小时浅滩不会开放；机帆可低速硬推，或等待涨潮。';
  if (mode === 'motor' && fuel > state.fuel) blocked = `燃料不足：预计约 ${fuel.toFixed(1)}，当前 ${state.fuel.toFixed(1)}。`;
  return { hours, fuel: Math.ceil(fuel * 2) / 2, blocked, minTide, avgTide, openWindows };
}

export function nextTideWindow(route: Route, hour: number, weather: Weather = 'clear'): number | null {
  if (!route.shallow) return 0;
  for (let d = 0; d <= 12; d += 0.5) {
    if (shallowOpen(hour + d, weather)) return d;
  }
  return null;
}

export function log(state: GameState, category: GameState['logs'][number]['category'], text: string, atHour = state.hour): void {
  state.logs.unshift({
    id: state.logs.length ? Math.max(...state.logs.map((l) => l.id)) + 1 : 1,
    day: dayOf(atHour),
    hour: atHour,
    category,
    text
  });
  state.logs = state.logs.slice(0, 140);
}

export function changeRelation(state: GameState, island: IslandId, amount: number, reason: string): void {
  const before = state.relations[island] ?? 50;
  const after = clamp(before + amount, 0, 100);
  state.relations[island] = after;
  if (amount !== 0) {
    const sign = amount > 0 ? `+${amount}` : `${amount}`;
    log(state, '关系', `${ISLAND_MAP[island].name}关系 ${sign}（${reason}）：${before} → ${after}`);
  }
}

export function relationLabel(value: number): string {
  if (value >= 80) return '信赖';
  if (value >= 62) return '友善';
  if (value >= 40) return '生疏';
  if (value >= 22) return '戒备';
  return '敌对';
}

export function marketRate(state: GameState, island: IslandId): number {
  const r = state.relations[island] ?? 50;
  if (r >= 75) return 0.9;
  if (r <= 25) return 1.15;
  return 1;
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function spawnDailyMail(state: GameState): boolean {
  const day = dayOf(state.hour);
  const flag = `mailDay${day}`;
  if (state.flags[flag] || day > RUN_DAYS_IN_STATE) return false;
  state.flags[flag] = true;

  const rng = makeRng(state.seed + day * 997 + state.cycle * 31);
  const validIslands = ISLANDS.filter((i) => i.id !== 'gull');
  for (let n = 0; n < 2; n += 1) {
    let fromIsland = validIslands[Math.floor(rng() * validIslands.length)];
    const choices = neighborsOf(fromIsland.id)
      .map((r) => otherEnd(r, fromIsland.id))
      .filter((id) => id !== fromIsland.id);
    if (!choices.length) continue;
    const to = choices[Math.floor(rng() * choices.length)];
    const template = GENERIC_MAIL_TEMPLATES[Math.floor(rng() * GENERIC_MAIL_TEMPLATES.length)];
    const extra = Math.floor(rng() * 4);
    const deadline = state.hour + template.window[0] + rng() * (template.window[1] - template.window[0]);
    state.mails.push({
      id: newId('g'),
      from: fromIsland.id,
      to,
      title: `${ISLAND_MAP[to].name}${template.suffix}`,
      sender: `${fromIsland.name}委托人`,
      recipient: `${ISLAND_MAP[to].name}居民`,
      weight: template.weight,
      reward: template.reward + extra,
      deadline: Math.ceil(deadline),
      secrecy: template.secrecy,
      summary: template.summary,
      body: template.body,
      status: 'available',
      genericKind: template.suffix
    });
  }
  log(state, '信件', `邮袋板更新：两处岛民留下了新的委托信。`);
  return true;
}

const RUN_DAYS_IN_STATE = 6;

export function createState(cycle = 1, memories: GameState['memories'] = [], seed = Math.floor(Math.random() * 1_000_000_000)): GameState {
  const bonusSilver = Math.min(cycle - 1, 3) * 6;
  const state: GameState = {
    version: 1,
    started: false,
    ended: false,
    seed,
    cycle,
    runId: newId('run'),
    hour: 6,
    maxHour: MAX_HOUR,
    at: 'tidehome',
    silver: 30 + bonusSilver,
    fuel: 16,
    hull: 10,
    maxHull: 10,
    sealKits: 2,
    tools: {},
    upgrades: { cargo: 0, tank: 0, engine: 0, hull: 0 },
    relations: {
      tidehome: 54,
      saltmere: 50,
      crab: 50,
      lantern: 49,
      brinewatch: 48,
      thorn: 42,
      gull: 45
    },
    mails: INITIAL_MAILS.map((m) => ({ ...m })),
    removedMailIds: [],
    logs: [],
    flags: {
      introShown: false,
      guideSeen: false,
      hiddenChartKnown: false,
      customsSearched: false,
      mayorOffered: false,
      festivalDone: false,
      castawayRescued: false,
      stormResolved: false,
      smugglerDealt: false,
      willReadLastRun: false
    },
    stats: {
      distance: 0,
      delivered: 0,
      late: 0,
      opened: 0,
      discarded: 0,
      stormsSurvived: 0,
      eventsResolved: 0,
      fuelUsed: 0
    },
    travel: {
      active: false,
      routeId: '',
      from: 'tidehome',
      to: 'tidehome',
      mode: 'sail',
      progress: 0,
      total: 0,
      fuelPlanned: 0,
      weather: 'clear',
      paused: false
    },
    memories
  };

  if (cycle > 1 && memories.length) {
    const last = memories[0];
    state.flags.willReadLastRun = last.carriedSecret === 'will-read';
    log(state, '周目', `第 ${cycle} 次潮邮：老局长看你的眼神像在确认一段旧梦。继承银币 ${bonusSilver}。`);
  } else {
    log(state, '周目', '第一轮潮邮开始。总局木钟指向第 1 日 06:00。');
  }
  log(state, '航行', '邮船“退潮针”停靠潮汐港，船舱只能装下有限信袋。');
  return state;
}

export function saveGame(state: GameState): void {
  state.lastSave = Date.now();
  // 槽位同样写带封签的信封：手改 localStorage 会破坏封签，读取时被拒绝。
  localStorage.setItem(SAVE_KEY, JSON.stringify(sealState(state)));
}

// ---------------------------------------------------------------------------
// 完整性封签：备份文件与存档槽位都是一个信封，封签覆盖信封里除 seal 外的
// 全部字段——包括玩家在确认弹窗看到的时间戳、格式号。任何手工改动（改负数
// 重量、伪造备份时间、改格式号、增删字段）都会使封签不符而整体拒绝。
// 注意：这是防呆/防作弊的完整性校验，不是加密签名；盐值写在前端代码里，
// 刻意逆向的人总能绕过，但“随手改一下文件”的存档不会再被接受。
// ---------------------------------------------------------------------------

const SEAL_SALT_A = 'tidal-post-office::seal-v2::退潮针';
const SEAL_SALT_B = 'saltmere-tide-seal::七岛潮邮信封不可篡改';

/** 稳定序列化：对象键排序，保证同一内容的封签可复现、与 JSON 排版无关。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 封签载荷：信封除 seal 外的全部字段，时间戳/格式号同样被封签绑定。 */
interface SealPayload {
  app: string;
  kind: string;
  format: number;
  at: string;
  state: GameState;
}

function computeSeal(payload: SealPayload): string {
  const canonical = stableStringify(payload);
  // 两轮加盐哈希拼接，提高手改者直接猜出格式的门槛。
  const h1 = hashString(SEAL_SALT_A + canonical);
  const h2 = hashString(canonical + SEAL_SALT_B + h1.toString(16));
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/** 常量时间比较，避免通过比较耗时侧信道猜测封签。 */
function sealMatches(a: string, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// 存档/备份校验：恢复文件来自玩家本机，可能被截断、手改或来自其他工具。
// 写回 localStorage 之前要过两道关：信封+数值的逐字段校验，以及全信封封签。
// 任何一关不过都整体拒绝，绝不覆盖好存档。
// ---------------------------------------------------------------------------

const ISLAND_IDS: readonly string[] = ISLANDS.map((i) => i.id);
const MAIL_STATUSES = ['available', 'accepted', 'delivered', 'returned', 'discarded'] as const;
const SECRECY_LEVELS = ['公开', '普通', '私密', '机密'] as const;
const LOG_CATEGORIES = ['航行', '信件', '事件', '关系', '船舶', '周目'] as const;
const WEATHERS = ['clear', 'fog', 'storm'] as const;
const TRAVEL_MODES = ['sail', 'motor'] as const;
const TOOL_IDS = ['almanac', 'chronometer', 'spyglass', 'pouch'] as const;
const FLAG_KEYS = [
  'introShown',
  'guideSeen',
  'hiddenChartKnown',
  'customsSearched',
  'mayorOffered',
  'festivalDone',
  'festivalJoined',
  'castawayRescued',
  'castawayIgnored',
  'castawayRewarded',
  'stormResolved',
  'stormWaited',
  'stormRushed',
  'stormSacrificedMail',
  'bribedCustoms',
  'blueGlassSilent',
  'blueGlassReported',
  'smugglerDealt',
  'smugglerPrepaid',
  'willConfronted',
  'willLied',
  'willConfessed',
  'willKept',
  'willReadLastRun',
  'memoryTalked'
] as const;
/** spawnDailyMail 每天动态写入的标记：mailDay1 … mailDayN。 */
const DYNAMIC_FLAG_PATTERN = /^mailDay\d{1,3}$/;

/** 标记键必须是游戏已知事件标记或每日刷信的动态标记。 */
function isKnownFlagKey(key: string): boolean {
  return FLAG_KEYS.includes(key as (typeof FLAG_KEYS)[number]) || DYNAMIC_FLAG_PATTERN.test(key);
}
const MAX_UPGRADE_LEVEL = 3;
const MAX_STORED_MEMORIES = 10;
const MAX_MEMORY_LOGS = 100;

// 数值边界。不是“好看的上限”，而是规则本身允许的范围：超出即可认定被篡改。
const LIMITS = {
  cycle: [1, 1000] as const,
  hour: [0, 200] as const,
  silver: [0, 100000] as const,
  fuel: [0, 100] as const, // 容量上限 24 + 3*8 = 48，留余量
  hull: [0, 30] as const,
  maxHull: [1, 30] as const,
  sealKits: [0, 99] as const,
  relation: [0, 100] as const,
  mailWeight: [1, 20] as const,
  mailReward: [0, 1000] as const,
  mailDeadline: [0, 1000] as const,
  distance: [0, 10000] as const,
  stat: [0, 100000] as const,
  score: [-100000, 100000] as const,
  fuelPlanned: [0, 1000] as const,
  logText: 400,
  shortText: 120
};

export type StateValidation = { ok: true; state: GameState } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = (v: unknown, list: readonly string[]): boolean => typeof v === 'string' && list.includes(v);

function inRange(v: number, range: readonly [number, number]): boolean {
  return v >= range[0] && v <= range[1];
}

function reject(path: string, reason: string): StateValidation {
  return { ok: false, error: `备份校验未通过（${path}）：${reason}` };
}

function checkNum(v: unknown, path: string, range: readonly [number, number], integer = false): StateValidation | null {
  const typeOk = integer ? isInt(v) : isNum(v);
  if (!typeOk) return reject(path, integer ? '必须是整数' : '必须是数字');
  const n = v as number;
  if (!inRange(n, range)) return reject(path, `数值 ${n} 超出允许范围 ${range[0]}～${range[1]}`);
  return null;
}

function checkString(v: unknown, path: string, maxLength: number): StateValidation | null {
  if (typeof v !== 'string') return reject(path, '必须是文本');
  if (v.length === 0) return reject(path, '不能为空字符串');
  if (v.length > maxLength) return reject(path, `文本长度 ${v.length} 超过上限 ${maxLength}`);
  return null;
}

function validateLog(raw: unknown): LogEntry | null {
  if (!isObj(raw)) return null;
  if (!isInt(raw.id) || raw.id < 1) return null;
  if (!isNum(raw.hour) || !inRange(raw.hour, LIMITS.hour)) return null;
  if (!isInt(raw.day) || !inRange(raw.day, [1, 20])) return null;
  if (!oneOf(raw.category, LOG_CATEGORIES)) return null;
  if (typeof raw.text !== 'string' || raw.text.length === 0 || raw.text.length > LIMITS.logText) return null;
  return {
    id: raw.id,
    hour: raw.hour,
    day: raw.day,
    category: raw.category as LogEntry['category'],
    text: raw.text
  };
}

function validateMail(raw: unknown, index: number): StateValidation {
  const path = `mails[${index}]`;
  if (!isObj(raw)) return reject(path, '不是有效对象');
  const m = raw as Record<string, unknown>;
  for (const f of ['id', 'title', 'sender', 'recipient', 'summary', 'body'] as const) {
    const err = checkString(m[f], `${path}.${f}`, f === 'body' ? 4000 : LIMITS.shortText);
    if (err) return err;
  }
  if ((m.id as string).length > 40) return reject(`${path}.id`, 'id 过长');
  if (!oneOf(m.from, ISLAND_IDS)) return reject(`${path}.from`, '不是已知岛屿');
  if (!oneOf(m.to, ISLAND_IDS)) return reject(`${path}.to`, '不是已知岛屿');
  for (const [f, range, integer] of [
    ['weight', LIMITS.mailWeight, true],
    ['reward', LIMITS.mailReward, true],
    ['deadline', LIMITS.mailDeadline, false]
  ] as Array<[string, readonly [number, number], boolean]>) {
    const err = checkNum(m[f], `${path}.${f}`, range, integer);
    if (err) return err;
  }
  if (!oneOf(m.secrecy, SECRECY_LEVELS)) return reject(`${path}.secrecy`, '密级无法识别');
  if (!oneOf(m.status, MAIL_STATUSES)) return reject(`${path}.status`, '信件状态无法识别');
  for (const f of ['acceptedAt', 'deliveredAt'] as const) {
    if (m[f] !== undefined) {
      const err = checkNum(m[f], `${path}.${f}`, LIMITS.mailDeadline);
      if (err) return err;
    }
  }
  for (const f of ['opened', 'tampered'] as const) {
    if (m[f] !== undefined && !isBool(m[f])) return reject(`${path}.${f}`, '必须是布尔值');
  }
  for (const f of ['special', 'genericKind'] as const) {
    if (m[f] !== undefined) {
      const err = checkString(m[f], `${path}.${f}`, 40);
      if (err) return err;
    }
  }
  // 跨字段一致性：状态与时间戳不能互相矛盾。
  // 注意：棘木湾走私包裹直接上船，早期版本不写 acceptedAt，所以该字段对 accepted 不强制。
  if (m.status === 'delivered' && m.deliveredAt === undefined) return reject(path, '已送达信件缺少 deliveredAt');
  if (isNum(m.deliveredAt) && isNum(m.acceptedAt) && m.deliveredAt < m.acceptedAt) {
    return reject(path, '送达时间早于接载时间');
  }
  return { ok: true, state: m as unknown as GameState };
}

function validateRelations(raw: unknown, path: string): StateValidation {
  if (!isObj(raw)) return reject(path, '必须是关系值对象');
  for (const id of ISLAND_IDS) {
    const err = checkNum(raw[id], `${path}.${id}`, LIMITS.relation, true);
    if (err) return err;
  }
  return { ok: true, state: raw as unknown as GameState };
}

function validateMemory(raw: unknown, index: number): StateValidation {
  const path = `memories[${index}]`;
  if (!isObj(raw)) return reject(path, '不是有效对象');
  const mem = raw as Record<string, unknown>;
  for (const f of ['id', 'date', 'endingTitle', 'carriedSecret'] as const) {
    const err = checkString(mem[f], `${path}.${f}`, f === 'id' ? 40 : LIMITS.shortText);
    if (err) return err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mem.date as string)) return reject(`${path}.date`, '日期必须是 YYYY-MM-DD');
  for (const [f, range] of [
    ['cycle', LIMITS.cycle],
    ['score', LIMITS.score],
    ['delivered', LIMITS.stat],
    ['late', LIMITS.stat],
    ['opened', LIMITS.stat],
    ['discarded', LIMITS.stat],
    ['stormsSurvived', LIMITS.stat]
  ] as Array<[string, readonly [number, number]]>) {
    const err = checkNum(mem[f], `${path}.${f}`, range, true);
    if (err) return err;
  }
  if (!Array.isArray(mem.bestRelations)) return reject(`${path}.bestRelations`, '必须是数组');
  if (mem.bestRelations.length > 3) return reject(`${path}.bestRelations`, '最多记录 3 个岛屿');
  for (const pair of mem.bestRelations as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !isInt(pair[1]) || !inRange(pair[1], LIMITS.relation)) {
      return reject(`${path}.bestRelations`, '条目必须是 [已知岛屿, 0～100 整数]');
    }
    if (!ISLAND_IDS.includes(pair[0])) return reject(`${path}.bestRelations`, '出现未知岛屿');
  }
  const rel = validateRelations(mem.finalRelations, `${path}.finalRelations`);
  if (!rel.ok) return rel;
  if (mem.logs !== undefined && !Array.isArray(mem.logs)) return reject(`${path}.logs`, '必须是数组');
  if (Array.isArray(mem.logs) && mem.logs.length > MAX_MEMORY_LOGS) {
    return reject(`${path}.logs`, `单轮日志最多 ${MAX_MEMORY_LOGS} 条`);
  }
  return { ok: true, state: mem as unknown as GameState };
}

/**
 * 逐字段校验一份疑似 GameState 的 JSON：
 * 类型、数值范围、枚举、跨字段一致性全部检查。
 * 仅老版本存档确实可缺的字段（memories、removedMailIds、旧周目 logs）做容错。
 */
export function validateGameState(raw: unknown): StateValidation {
  if (!isObj(raw)) return { ok: false, error: '备份内容不是有效的存档对象。' };
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) return reject('version', `期望存档版本 1，实际为 ${String(s.version)}`);

  for (const f of ['started', 'ended'] as const) {
    if (!isBool(s[f])) return reject(f, '必须是布尔值');
  }
  const scalarChecks: Array<[string, readonly [number, number], boolean]> = [
    ['seed', [-1e12, 1e12], true],
    ['cycle', LIMITS.cycle, true],
    ['hour', LIMITS.hour, false],
    ['maxHour', [1, 200], false],
    ['silver', LIMITS.silver, true],
    ['fuel', LIMITS.fuel, false],
    ['hull', LIMITS.hull, false],
    ['maxHull', LIMITS.maxHull, false],
    ['sealKits', LIMITS.sealKits, true]
  ];
  for (const [f, range, integer] of scalarChecks) {
    const err = checkNum(s[f], f, range, integer);
    if (err) return err;
  }
  const hour = s.hour as number;
  const maxHour = s.maxHour as number;
  const hull = s.hull as number;
  const maxHull = s.maxHull as number;
  const fuel = s.fuel as number;
  if (hour > maxHour) return reject('hour', '当前时间超过本局最大时间');
  if (hull > maxHull) return reject('hull', '当前船壳不能高于最大船壳');
  if (fuel > 24 + (isObj(s.upgrades) ? (Number(s.upgrades.tank) || 0) : 0) * 8 + 0.001) {
    return reject('fuel', '燃料超过煤油柜容量，数据自相矛盾');
  }

  const runErr = checkString(s.runId, 'runId', 40);
  if (runErr) return runErr;
  if (!oneOf(s.at, ISLAND_IDS)) return reject('at', '当前位置不是已知岛屿');

  if (!isObj(s.tools)) return reject('tools', '必须是对象');
  for (const [k, v] of Object.entries(s.tools)) {
    if (!TOOL_IDS.includes(k as (typeof TOOL_IDS)[number])) return reject(`tools.${k}`, '出现未知工具');
    if (!isBool(v)) return reject(`tools.${k}`, '工具只能是布尔值');
  }

  if (!isObj(s.upgrades)) return reject('upgrades', '必须是对象');
  for (const f of ['cargo', 'tank', 'engine', 'hull'] as const) {
    const err = checkNum(s.upgrades[f], `upgrades.${f}`, [0, MAX_UPGRADE_LEVEL], true);
    if (err) return err;
  }

  const rel = validateRelations(s.relations, 'relations');
  if (!rel.ok) return rel;

  if (!Array.isArray(s.mails)) return reject('mails', '必须是数组');
  if (s.mails.length > 200) return reject('mails', '信件数量超过上限');
  const mailIds = new Set<string>();
  for (let i = 0; i < s.mails.length; i += 1) {
    const mail = validateMail(s.mails[i], i);
    if (!mail.ok) return mail;
    const id = (s.mails[i] as Record<string, unknown>).id as string;
    if (mailIds.has(id)) return reject(`mails[${i}].id`, '信件 id 重复');
    mailIds.add(id);
  }

  if (s.removedMailIds !== undefined) {
    if (!Array.isArray(s.removedMailIds) || s.removedMailIds.some((id) => typeof id !== 'string')) {
      return reject('removedMailIds', '必须是字符串数组');
    }
  }
  if (!Array.isArray(s.logs)) return reject('logs', '必须是数组');
  if (s.logs.length > 200) return reject('logs', '在航日志超过 140 条上限');
  for (let i = 0; i < s.logs.length; i += 1) {
    if (!validateLog(s.logs[i])) return reject(`logs[${i}]`, '日志条目字段不完整或数值越界');
  }

  if (!isObj(s.flags)) return reject('flags', '必须是对象');
  for (const [k, v] of Object.entries(s.flags)) {
    if (!isKnownFlagKey(k)) return reject(`flags.${k}`, '出现游戏不会写入的未知标记');
    if (!(['boolean', 'number', 'string'].includes(typeof v))) return reject(`flags.${k}`, '只能是布尔值、数字或文本');
    if (typeof v === 'number' && !(isNum(v) && inRange(v, [-1e9, 1e9]))) return reject(`flags.${k}`, '数字越界');
    if (typeof v === 'string' && v.length > 60) return reject(`flags.${k}`, '文本过长');
  }

  if (!isObj(s.stats)) return reject('stats', '必须是对象');
  for (const f of ['distance', 'delivered', 'late', 'opened', 'discarded', 'stormsSurvived', 'eventsResolved', 'fuelUsed'] as const) {
    const err = checkNum(s.stats[f], `stats.${f}`, f === 'distance' || f === 'fuelUsed' ? LIMITS.distance : LIMITS.stat, f !== 'distance' && f !== 'fuelUsed');
    if (err) return err;
  }

  const t = s.travel;
  if (!isObj(t)) return reject('travel', '必须是对象');
  if (!isBool(t.active) || !isBool(t.paused)) return reject('travel', 'active/paused 必须是布尔值');
  if (typeof t.routeId !== 'string' || t.routeId.length > 40) return reject('travel.routeId', '必须是短文本');
  if (t.routeId !== '' && !ROUTES.some((r) => r.id === t.routeId)) return reject('travel.routeId', '不是已知航线');
  if (!oneOf(t.from, ISLAND_IDS)) return reject('travel.from', '不是已知岛屿');
  if (!oneOf(t.to, ISLAND_IDS)) return reject('travel.to', '不是已知岛屿');
  if (!oneOf(t.mode, TRAVEL_MODES)) return reject('travel.mode', '航行模式无法识别');
  if (!oneOf(t.weather, WEATHERS)) return reject('travel.weather', '天气无法识别');
  for (const [f, range] of [
    ['progress', LIMITS.distance],
    ['total', LIMITS.distance],
    ['fuelPlanned', LIMITS.fuelPlanned]
  ] as Array<[string, readonly [number, number]]>) {
    const err = checkNum(t[f], `travel.${f}`, range);
    if (err) return err;
  }
  const progress = t.progress as number;
  const total = t.total as number;
  if (progress > total + 0.001) return reject('travel.progress', '进度不能超过航线总距离');
  if (t.active) {
    if (t.to === t.from) return reject('travel', '航行中起讫岛屿不能相同');
    if (total <= 0) return reject('travel.total', '航行中总距离必须为正');
  }
  for (const f of ['blockingEvent', 'blockedMail'] as const) {
    if (t[f] !== undefined && t[f] !== null && typeof t[f] !== 'string') return reject(`travel.${f}`, '必须是文本或 null');
  }

  if (s.activePortEvent !== undefined && s.activePortEvent !== null && typeof s.activePortEvent !== 'string') {
    return reject('activePortEvent', '必须是文本或 null');
  }

  if (s.memories !== undefined && !Array.isArray(s.memories)) return reject('memories', '必须是数组');
  if (Array.isArray(s.memories) && s.memories.length > MAX_STORED_MEMORIES) {
    return reject('memories', `最多保留 ${MAX_STORED_MEMORIES} 轮记忆`);
  }
  const memories = Array.isArray(s.memories) ? s.memories : [];
  for (let i = 0; i < memories.length; i += 1) {
    const memory = validateMemory(memories[i], i);
    if (!memory.ok) return memory;
  }

  if (s.lastSave !== undefined) {
    const err = checkNum(s.lastSave, 'lastSave', [0, 4.1e12]);
    if (err) return err;
  }
  return { ok: true, state: s as unknown as GameState };
}

/** 校验并补齐老存档可缺字段，返回可安全运行的 GameState；失败返回带原因的错误。 */
export function loadStateFromJson(raw: unknown): StateValidation {
  const checked = validateGameState(raw);
  if (!checked.ok) return checked;
  const state = checked.state;
  // 老版本容错：周目摘要可能没有 logs / cycle，removedMailIds 也可能缺失。
  state.removedMailIds = Array.isArray(state.removedMailIds) ? state.removedMailIds : [];
  state.memories = (state.memories ?? []).map((memory, index) => ({
    ...memory,
    cycle: memory.cycle ?? index + 1,
    logs: Array.isArray(memory.logs)
      ? // 损坏的单条日志只影响展示，过滤掉而不是拒绝整份备份。
        memory.logs.filter((entry): entry is LogEntry => Boolean(validateLog(entry)))
      : []
  }));
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// 存档槽位与备份文件共用同一种“全信封封签”格式：封签覆盖除 seal 外的全部
// 字段（app/kind/format/at/state），玩家在确认弹窗看到的时间戳与格式号无法
// 被单独伪造；键集合也固定，增删任何字段都会被拒绝。
// ---------------------------------------------------------------------------

export const BACKUP_APP = 'tidal-post-office';
export const SAVE_KIND = 'save-sealed' as const;
export const BACKUP_KIND = 'save-backup' as const;
export const BACKUP_FORMAT = 1;

/** 信封唯一允许的键，多一个、少一个都视为被改动过。 */
const ENVELOPE_KEYS = ['app', 'kind', 'format', 'at', 'state', 'seal'] as const;
const SEAL_PATTERN = /^[0-9a-f]{16}$/;

/**
 * 备份信封（存档槽位使用同构结构，只是 kind 为 save-sealed）。
 * 注意 at（封签/导出时间戳）本身也被封签绑定。
 */
export interface BackupEnvelope {
  app: typeof BACKUP_APP;
  kind: typeof SAVE_KIND | typeof BACKUP_KIND;
  format: number;
  at: string;
  state: GameState;
  seal: string;
}

/**
 * 时间戳必须与 Date#toISOString 的规范输出完全一致（含毫秒与 Z）：
 * 正则挡住形状错误，往返一致挡住 2099-13-45T99:99 这类会被 Date 自动进位的伪造日期。
 */
function validTimestamp(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return false;
  if (new Date(t).toISOString() !== v) return false;
  // 允许 2000-01-01 ～ 2100-01-01，挡掉异常年份。
  return t >= Date.UTC(2000, 0, 1) && t <= Date.UTC(2100, 0, 1);
}

function makeEnvelope(kind: BackupEnvelope['kind'], state: GameState, at: Date): BackupEnvelope {
  const snapshot = JSON.parse(JSON.stringify(state)) as GameState;
  const atIso = at.toISOString();
  const payload: SealPayload = { app: BACKUP_APP, kind, format: BACKUP_FORMAT, at: atIso, state: snapshot };
  return {
    app: BACKUP_APP,
    kind,
    format: BACKUP_FORMAT,
    at: atIso,
    state: snapshot,
    seal: computeSeal(payload)
  };
}

/** 游戏内存档：槽位信封。 */
function sealState(state: GameState): BackupEnvelope {
  return makeEnvelope(SAVE_KIND, state, new Date());
}

function isEnvelopeLike(obj: Record<string, unknown>): boolean {
  return obj.app === BACKUP_APP || obj.kind === SAVE_KIND || obj.kind === BACKUP_KIND;
}

export type EnvelopeOpenResult =
  | { ok: true; state: GameState; envelope: BackupEnvelope }
  | { ok: false; error: string };

/**
 * 打开并验证一个封签信封（槽位存档与备份文件共用）：
 * 1. 键集合必须恰好是约定的 6 个字段——插入任何额外字段直接拒绝；
 * 2. app/kind/format/at/seal 的类型、取值与时间戳真实性逐项检查；
 * 3. state 通过深度结构与数值范围校验；
 * 4. 用信封全部元数据 + state 重算全信封封签，不符即拒绝。
 * 在 1～4 全部通过前，信封里的任何信息都不可信、不会展示给玩家。
 */
function openSealedEnvelope(raw: Record<string, unknown>, expectedKind: string): EnvelopeOpenResult {
  const fail = (error: string): EnvelopeOpenResult => ({ ok: false, error });

  const keys = Object.keys(raw).sort();
  const expectedKeys = [...ENVELOPE_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((k, i) => k !== expectedKeys[i])) {
    return fail('备份信封字段集合不正确（缺少或多出字段），文件可能被手工编辑过。');
  }
  if (typeof raw.seal !== 'string' || !SEAL_PATTERN.test(raw.seal)) {
    return fail('封签缺失或格式不对，文件可能被手工编辑过。');
  }
  if (raw.app !== BACKUP_APP) return fail('文件标记与《潮汐邮局》备份不一致。');
  if (raw.kind !== expectedKind) {
    return fail(expectedKind === BACKUP_KIND ? '这不是备份文件（存档槽位数据不能直接当作备份恢复）。' : '存档类型标记不正确。');
  }
  if (!isInt(raw.format) || raw.format < 1) return fail('格式版本号无效。');
  if (raw.format > BACKUP_FORMAT) {
    return fail(`备份来自更新版本（格式 v${raw.format}），当前游戏无法读取。`);
  }
  if (!validTimestamp(raw.at)) return fail('备份时间戳缺失、格式不对或日期不真实（元数据可能被伪造）。');
  if (!isObj(raw.state)) return fail('信封完好，但里面没有存档数据。');

  // 先按结构/范围校验 state；归一化（补老字段）不能参与封签，
  // 所以对原始 state 对象计算，保证与导出时逐字节对应。
  const structural = validateGameState(raw.state);
  if (!structural.ok) return fail(structural.error);

  const payload: SealPayload = {
    app: raw.app as string,
    kind: raw.kind as string,
    format: raw.format as number,
    at: raw.at as string,
    state: raw.state as unknown as GameState
  };
  if (!sealMatches(raw.seal, computeSeal(payload))) {
    return fail('完整性封签不匹配：文件内容（含备份时间等元数据）被手工修改或下载不完整，按规程拒绝加载。');
  }

  const normalized = loadStateFromJson(raw.state);
  if (!normalized.ok) return fail(normalized.error);
  return { ok: true, state: normalized.state, envelope: raw as unknown as BackupEnvelope };
}

export function loadGame(): GameState | null {
  const rawText = localStorage.getItem(SAVE_KEY);
  if (!rawText) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;

  if (isEnvelopeLike(raw)) {
    const result = openSealedEnvelope(raw, SAVE_KIND);
    return result.ok ? result.state : null;
  }

  // 一次性兼容：全信封封签上线前写入的裸 state（结构合法才迁移，下一次保存自动加封签）。
  if (typeof raw.version === 'number') {
    const legacy = loadStateFromJson(raw);
    return legacy.ok ? legacy.state : null;
  }
  return null;
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

/** 只有槽位中的内容能通过封签与完整校验，才算“有存档”。 */
export function hasSave(): boolean {
  return loadGame() !== null;
}

// ---------------------------------------------------------------------------
// 可携带本地备份：单个带全信封封签的 .json 文件带走当前进度与全部多周目记忆。
// ---------------------------------------------------------------------------

export function createBackup(state: GameState, exportedAt: Date = new Date()): BackupEnvelope {
  return makeEnvelope(BACKUP_KIND, state, exportedAt);
}

export type BackupParseResult = EnvelopeOpenResult;

/**
 * 解析备份文件文本：
 * - 只接受游戏导出、带全信封封签的备份；
 * - 时间戳/格式号等元数据本身也在封签范围内，无法单独伪造；
 * - 增删字段、手改任意值、截断、结构残缺或数值越界都整体拒绝；
 * - 不接受手拼的裸 JSON（包括直接复制自 localStorage 的内容）。
 */
export function parseBackupText(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON，可能下载不完整或被改动过。' };
  }
  if (!isObj(raw)) return { ok: false, error: '备份文件内容为空或格式不对。' };

  if (isEnvelopeLike(raw)) {
    return openSealedEnvelope(raw, BACKUP_KIND);
  }

  if (typeof raw.version === 'number') {
    return {
      ok: false,
      error: '这是未加封签的裸存档（可能直接复制自 localStorage 或被手工编辑）。请使用游戏“导出备份”生成的文件恢复。'
    };
  }
  return { ok: false, error: '无法识别：请选择游戏导出的 .json 备份文件。' };
}

/** 备份下载文件名：tidal-post-office-backup-YYYYMMDD-HHMM-cycleN.json。 */
export function backupFileName(envelope: BackupEnvelope): string {
  const d = new Date(envelope.at);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}`;
  return `tidal-post-office-backup-${stamp}-cycle${envelope.state.cycle}.json`;
}


export function priceOf(state: GameState, island: IslandId, base: number): number {
  return Math.max(1, Math.round(base * marketRate(state, island)));
}

export function upgradeById(id: string) {
  return UPGRADES.find((u) => u.id === id);
}

export function availableAtIsland(state: GameState, island: IslandId) {
  return UPGRADES.filter((u) => u.island === island || u.id === 'sealkit').map((u) => {
    const level = u.id === 'sealkit' ? 0 : u.kind === 'consumable' ? 0 : u.kind === 'tool' ? (state.tools[u.id] ? 1 : 0) : state.upgrades[u.kind];
    return { def: u, level, maxed: level >= u.maxLevel };
  });
}

export function acceptedMails(state: GameState): Mail[] {
  return state.mails.filter((m) => m.status === 'accepted');
}

export function outgoingAt(state: GameState, island: IslandId): Mail[] {
  return state.mails.filter((m) => m.status === 'available' && m.from === island && !state.removedMailIds.includes(m.id));
}

export function secrecyDanger(secrecy: Secrecy): string {
  switch (secrecy) {
    case '公开':
      return '可公开宣读';
    case '普通':
      return '不应私拆';
    case '私密':
      return '私拆会严重冒犯';
    case '机密':
      return '受邮政封蜡保护';
  }
}

export function mailWeightAtIsland(state: GameState, island: IslandId): number {
  return outgoingAt(state, island).reduce((sum, m) => sum + Math.max(0, m.weight), 0);
}

export function advanceHourChecks(state: GameState): string[] {
  const notices: string[] = [];
  state.hour += 1;
  spawnDailyMail(state);

  const expired = acceptedMails(state).filter((m) => state.hour > m.deadline && !m.deliveredAt && m.special !== 'will');
  for (const mail of expired) {
    mail.status = 'returned';
    state.stats.late += 1;
    changeRelation(state, mail.from, -4, '信件超期');
    changeRelation(state, mail.to, -3, '等待落空');
    notices.push(`《${mail.title}》超过期限，被退回邮袋板。`);
    log(state, '信件', `《${mail.title}》超期：${ISLAND_MAP[mail.from].name} → ${ISLAND_MAP[mail.to].name}。`);
  }
  return notices;
}

export function canDiscard(mail: Mail): { ok: boolean; reason?: string } {
  if (mail.status !== 'accepted') return { ok: false, reason: '只能处理已接载的信。' };
  if (mail.secrecy === '机密' || mail.special === 'will') return { ok: false, reason: '邮政规程禁止抛弃机密或署长封缄信。' };
  return { ok: true };
}

export function discardMail(state: GameState, mail: Mail): void {
  const check = canDiscard(mail);
  if (!check.ok) return;
  mail.status = 'discarded';
  mail.tampered = true;
  state.stats.discarded += 1;
  changeRelation(state, mail.from, -7, '委托信被遗弃');
  changeRelation(state, mail.to, -2, '信件失踪');
  log(state, '信件', `你把《${mail.title}》丢进了储物格，信纸在船舱里发出很轻的声响。`);
}

export function openMail(state: GameState, mail: Mail): void {
  if (mail.status !== 'accepted' || mail.opened) return;
  mail.opened = true;
  mail.tampered = true;
  state.stats.opened += 1;
  const penalty = mail.secrecy === '机密' ? 4 : mail.secrecy === '私密' ? 2 : 0;
  if (penalty > 0 && !state.tools.pouch) changeRelation(state, mail.from, -penalty, '封蜡被撬动');
  log(state, '信件', `你私拆了《${mail.title}》。火漆裂开的声音比想象中清楚。`);
}

export function resealMail(state: GameState, mail: Mail): { ok: boolean; reason?: string } {
  if (mail.status !== 'accepted') return { ok: false, reason: '这封信不在船上。' };
  if (!mail.opened) return { ok: false, reason: '这封信仍然封着。' };
  if (state.sealKits <= 0) return { ok: false, reason: '没有火漆补封盒。' };
  state.sealKits -= 1;
  mail.tampered = mail.secrecy === '机密' || mail.special === 'will';
  log(state, '船舶', '你用新火漆盖住旧裂痕；折痕仍在，但至少看起来像一封完整的信。');
  return { ok: true };
}

function applySpecialIntact(state: GameState, mail: Mail): string[] {
  const notes: string[] = [];
  switch (mail.id) {
    case 'm-thorn-gull-chart':
      if (!mail.tampered) {
        state.flags.hiddenChartKnown = true;
        notes.push('观潮老人把两半海图对齐：暗礁航线已被标出。');
      }
      break;
    case 'm-lantern-love':
      if (!mail.opened) {
        state.silver += 6;
        changeRelation(state, 'lantern', 4, '守护了无名约定');
        notes.push('守灯人私下多塞给你 6 银币。');
      }
      break;
    case 'm-thorn-salt-promise':
      if (!mail.tampered) {
        state.silver += 5;
        notes.push('蜡丸中藏着的盐钱完整无缺，阿澈坚持分你 5 银币。');
      }
      break;
    default:
      break;
  }
  return notes;
}

export function deliverAtIsland(state: GameState, island: IslandId): { notes: string[]; delivered: number } {
  const notes: string[] = [];
  let delivered = 0;
  const mails = acceptedMails(state).filter((m) => m.to === island && m.special !== 'will');
  for (const mail of mails) {
    mail.status = 'delivered';
    mail.deliveredAt = state.hour;
    delivered += 1;
    state.stats.delivered += 1;
    const late = state.hour > mail.deadline;
    if (late) state.stats.late += 1;

    let reward = mail.reward;
    let amount = late ? 1 : 4;
    if (late) reward = Math.ceil(reward * 0.45);

    if (mail.tampered) {
      amount -= mail.secrecy === '机密' || mail.special === 'will' ? 8 : 4;
      reward = mail.secrecy === '公开' ? Math.ceil(reward * 0.7) : 0;
      notes.push(`《${mail.title}》的封蜡/折痕被发现了。`);
      log(state, '信件', `收信人察觉《${mail.title}》被拆动，关系明显下降。`);
    }
    if (mail.opened && !mail.tampered) amount -= 1;

    state.silver += reward;
    changeRelation(state, mail.to, amount, late ? '迟来的信件' : '准时送达');
    if (mail.from !== island) changeRelation(state, mail.from, late ? 1 : 2, '邮路有回音');
    notes.push(`送达《${mail.title}》：${late ? '延误' : '准时'}，报酬 ${reward} 银币。`);
    notes.push(...applySpecialIntact(state, mail));
  }
  return { notes, delivered };
}

export function repairCost(state: GameState): number {
  return Math.max(0, Math.ceil((state.maxHull - state.hull) * 3));
}

export function endingScore(state: GameState): number {
  const relationSum = Object.values(state.relations).reduce((a, b) => a + b, 0);
  return Math.round(
    state.stats.delivered * 18 +
      state.stats.late * -5 +
      state.stats.opened * -8 +
      state.stats.discarded * -12 +
      relationSum * 0.8 +
      state.stats.stormsSurvived * 8 +
      state.cycle * 10 +
      state.silver * 0.5
  );
}

export function endingTitle(score: number): string {
  if (score >= 520) return '群岛铭记的潮邮长';
  if (score >= 420) return '能听懂潮声的邮差';
  if (score >= 320) return '可靠的转潮人';
  if (score >= 220) return '仍在学习航线的水手';
  return '被潮水耽搁的新邮差';
}

export function routesFrom(state: GameState, island: IslandId): Route[] {
  return neighborsOf(island).filter((r) => canSeeRoute(state, r));
}

export function islandName(id: IslandId): string {
  return ISLAND_MAP[id].name;
}

export { ROUTES };
