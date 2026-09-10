export type IslandId =
  | 'tidehome'
  | 'saltmere'
  | 'crab'
  | 'lantern'
  | 'brinewatch'
  | 'thorn'
  | 'gull';

export type Secrecy = '公开' | '普通' | '私密' | '机密';
export type MailStatus = 'available' | 'accepted' | 'delivered' | 'returned' | 'discarded';
export type Weather = 'clear' | 'fog' | 'storm';
export type TravelMode = 'sail' | 'motor';

export interface Island {
  id: IslandId;
  name: string;
  alias: string;
  x: number;
  y: number;
  color: number;
  description: string;
  marketNote: string;
}

export interface Route {
  id: string;
  a: IslandId;
  b: IslandId;
  distance: number;
  shallow?: boolean;
  hidden?: boolean;
  current: number;
  risk?: string;
}

export interface Mail {
  id: string;
  from: IslandId;
  to: IslandId;
  title: string;
  sender: string;
  recipient: string;
  weight: number;
  reward: number;
  deadline: number;
  secrecy: Secrecy;
  summary: string;
  body: string;
  status: MailStatus;
  acceptedAt?: number;
  deliveredAt?: number;
  opened?: boolean;
  tampered?: boolean;
  special?: string;
  genericKind?: string;
}

export interface Upgrade {
  id: string;
  name: string;
  kind: 'tool' | 'cargo' | 'tank' | 'engine' | 'hull' | 'consumable';
  level: number;
  maxLevel: number;
  prices: number[];
  island: IslandId | 'any';
  description: string;
}

export interface LogEntry {
  id: number;
  hour: number;
  day: number;
  category: '航行' | '信件' | '事件' | '关系' | '船舶' | '周目';
  text: string;
}

export interface EventChoiceView {
  label: string;
  detail?: string;
  disabled?: string;
}

export interface EventOutcome {
  text: string;
  effects?: Partial<Pick<GameState, 'silver' | 'fuel' | 'hull' | 'sealKits'>> & {
    relations?: Partial<Record<IslandId, number>>;
    flags?: Record<string, boolean | number | string>;
    mailMutations?: string;
    nextEvent?: string;
    tool?: string;
    delayHours?: number;
    endVoyage?: boolean;
  };
}

export interface GameEventChoice extends EventChoiceView {
  condition?: (state: GameState, mail?: Mail) => { ok: boolean; reason?: string };
  outcome: (state: GameState, mail?: Mail) => EventOutcome;
}

export interface GameEvent {
  id: string;
  title: string;
  context: string;
  trigger: 'route' | 'port' | 'intro';
  weight?: number;
  once?: boolean;
  priority?: number;
  condition?: (state: GameState, ctx?: EventContext) => boolean;
  choices: (state: GameState, mail?: Mail) => GameEventChoice[];
}

export interface EventContext {
  from?: IslandId;
  to?: IslandId;
  routeId?: string;
  island?: IslandId;
  mode?: TravelMode;
  mail?: Mail;
}

export interface TravelStatus {
  active: boolean;
  routeId: string;
  from: IslandId;
  to: IslandId;
  mode: TravelMode;
  progress: number;
  total: number;
  fuelPlanned: number;
  weather: Weather;
  paused: boolean;
  blockingEvent?: string;
  blockedMail?: string;
}

export interface RunMemory {
  id: string;
  cycle: number;
  date: string;
  endingTitle: string;
  score: number;
  delivered: number;
  late: number;
  opened: number;
  discarded: number;
  bestRelations: [string, number][];
  carriedSecret: string;
  finalRelations: Record<IslandId, number>;
  stormsSurvived: number;
  /** 该轮结束时保留下来的具体航行/信件/事件日志（最新在前）。 */
  logs: LogEntry[];
}

export interface GameState {
  version: number;
  started: boolean;
  ended: boolean;
  seed: number;
  cycle: number;
  runId: string;
  hour: number;
  maxHour: number;
  at: IslandId;
  silver: number;
  fuel: number;
  hull: number;
  maxHull: number;
  sealKits: number;
  tools: Record<string, boolean>;
  upgrades: {
    cargo: number;
    tank: number;
    engine: number;
    hull: number;
  };
  relations: Record<IslandId, number>;
  mails: Mail[];
  removedMailIds: string[];
  logs: LogEntry[];
  flags: Record<string, boolean | number | string>;
  stats: {
    distance: number;
    delivered: number;
    late: number;
    opened: number;
    discarded: number;
    stormsSurvived: number;
    eventsResolved: number;
    fuelUsed: number;
  };
  travel: TravelStatus;
  activePortEvent?: string;
  memories: RunMemory[];
  lastSave?: number;
}
