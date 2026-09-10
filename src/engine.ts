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
  return state.mails.filter((m) => m.status === 'accepted').reduce((sum, m) => sum + m.weight, 0);
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
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

/**
 * 判断裸对象是否像一份有效的当前版本存档。
 * 备份文件与 localStorage 读入共用这套校验。
 */
export function isGameState(raw: unknown): raw is GameState {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Partial<GameState>;
  return s.version === 1 && typeof s.cycle === 'number' && Array.isArray(s.mails);
}

/** 把读入的 JSON 规整成 GameState；无法识别时返回 null。 */
export function normalizeLoadedState(raw: unknown): GameState | null {
  if (!isGameState(raw)) return null;
  const parsed = raw as GameState;
  parsed.memories = (parsed.memories ?? []).map((memory, index) => ({
    ...memory,
    cycle: memory.cycle ?? index + 1,
    logs: Array.isArray(memory.logs) ? memory.logs : []
  }));
  return parsed;
}

export function loadGame(): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return normalizeLoadedState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

export function hasSave(): boolean {
  return Boolean(localStorage.getItem(SAVE_KEY));
}

// ---------------------------------------------------------------------------
// 可携带本地备份：单个 .json 文件即可带走当前进度与全部多周目记忆，
// 不依赖浏览器 localStorage，清理数据或换设备后可整体恢复。
// ---------------------------------------------------------------------------

export const BACKUP_APP = 'tidal-post-office';
export const BACKUP_KIND = 'save-backup';
export const BACKUP_FORMAT = 1;

export interface BackupEnvelope {
  app: typeof BACKUP_APP;
  kind: typeof BACKUP_KIND;
  format: number;
  exportedAt: string;
  state: GameState;
}

export function createBackup(state: GameState, exportedAt: Date = new Date()): BackupEnvelope {
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    format: BACKUP_FORMAT,
    exportedAt: exportedAt.toISOString(),
    // 深拷贝：备份落盘后游戏继续进行也不会改变文件对应的状态。
    state: JSON.parse(JSON.stringify(state)) as GameState
  };
}

export type BackupParseResult =
  | { ok: true; state: GameState; envelope: BackupEnvelope | null }
  | { ok: false; error: string };

/**
 * 解析备份文件文本：
 * - 接受游戏导出的备份信封；
 * - 兼容直接从 localStorage 复制出的裸存档 JSON；
 * - 拒绝损坏内容与来自更新版本的存档。
 */
export function parseBackupText(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON。' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '备份文件内容为空或格式不对。' };
  const obj = raw as Record<string, unknown>;

  if (obj.app === BACKUP_APP || obj.kind === BACKUP_KIND) {
    if (obj.app !== BACKUP_APP || obj.kind !== BACKUP_KIND) {
      return { ok: false, error: '文件标记与《潮汐邮局》备份不一致。' };
    }
    if (typeof obj.format !== 'number') return { ok: false, error: '备份缺少格式版本号。' };
    if (obj.format > BACKUP_FORMAT) {
      return { ok: false, error: `备份来自更新版本（格式 v${obj.format}），当前游戏无法读取。` };
    }
    const state = normalizeLoadedState(obj.state);
    if (!state) return { ok: false, error: '备份外壳完好，但里面的存档数据已损坏。' };
    return { ok: true, state, envelope: raw as BackupEnvelope };
  }

  // 兼容玩家手动从 localStorage 拷贝的裸存档。
  if (typeof obj.version === 'number') {
    if (obj.version > 1) return { ok: false, error: `存档来自更新版本（v${obj.version}），当前游戏无法读取。` };
    const state = normalizeLoadedState(raw);
    if (!state) return { ok: false, error: '这不是《潮汐邮局》的存档内容。' };
    return { ok: true, state, envelope: null };
  }
  return { ok: false, error: '无法识别：请选择游戏导出的 .json 备份文件。' };
}

/** 备份下载文件名：tidal-post-office-backup-YYYYMMDD-HHMM-cycleN.json。 */
export function backupFileName(envelope: BackupEnvelope): string {
  const d = new Date(envelope.exportedAt);
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
  return outgoingAt(state, island).reduce((sum, m) => sum + m.weight, 0);
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
