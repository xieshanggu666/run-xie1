import type { Island, Mail, Route, Upgrade } from './types';

export const MAP_W = 650;
export const MAP_H = 560;
export const DAY_HOURS = 24;
export const RUN_DAYS = 6;
export const MAX_HOUR = RUN_DAYS * DAY_HOURS;

export const ISLANDS: Island[] = [
  {
    id: 'tidehome',
    name: '潮汐港',
    alias: '邮政总局',
    x: 318,
    y: 92,
    color: 0xf0d49a,
    description: '环形火山口中央的邮政总局，潮水会把信袋轻轻推上木栈码头。',
    marketNote: '基础工具齐全；老局长会给第一次出航的人留一份潮汐历。'
  },
  {
    id: 'saltmere',
    name: '盐泽礁',
    alias: '晒盐人的浅滩',
    x: 152,
    y: 214,
    color: 0xb7e3dc,
    description: '低矮沙洲与盐田交错，低潮时航道会露出黑色泥脊。',
    marketNote: '盐民擅长扩大防水邮袋，仓库改造比别处便宜。'
  },
  {
    id: 'crab',
    name: '蟹锣岛',
    alias: '鼓与红蟹潮',
    x: 244,
    y: 390,
    color: 0xe58f65,
    description: '岛民以红蟹壳为锣，节庆时整条海岸都咚咚作响。',
    marketNote: '红蟹油可做燃料，船匠也擅长加固船底。'
  },
  {
    id: 'lantern',
    name: '灯枝岛',
    alias: '海上灯笼树',
    x: 438,
    y: 344,
    color: 0xffc861,
    description: '树上挂满玻璃风灯，雾季时整座岛像一棵发光的海杉。',
    marketNote: '灯匠出售精密时计和雾航工具。'
  },
  {
    id: 'brinewatch',
    name: '咸望堡',
    alias: '关税与灯塔',
    x: 538,
    y: 168,
    color: 0x9db7d8,
    description: '石堡、税关与长灯塔控制着群岛东侧航路。',
    marketNote: '公文多，船用设备正规但价格昂贵。'
  },
  {
    id: 'thorn',
    name: '棘木湾',
    alias: '走私者的黑树',
    x: 92,
    y: 430,
    color: 0x8ac98f,
    description: '黑刺树沿海湾生长，船桅常被误认为树丛。',
    marketNote: '有些交易不上账，也有些消息不能让税关听见。'
  },
  {
    id: 'gull',
    name: '鸥栖屿',
    alias: '废弃观潮台',
    x: 568,
    y: 452,
    color: 0xd7e7f5,
    description: '小岛只剩观潮台和成群白鸥，据说能看见第二条回流。',
    marketNote: '没有商店，只有旧观潮员、暗号和被藏起来的海图。'
  }
];

export const ISLAND_MAP = Object.fromEntries(ISLANDS.map((i) => [i.id, i])) as Record<Island['id'], Island>;

export const ROUTES: Route[] = [
  { id: 'tide-salt', a: 'tidehome', b: 'saltmere', distance: 4, shallow: true, current: 1, risk: '低潮时浅滩会挡住船底' },
  { id: 'tide-brine', a: 'tidehome', b: 'brinewatch', distance: 5, current: 0, risk: '税关的巡逻艇常在此测船速' },
  { id: 'tide-lantern', a: 'tidehome', b: 'lantern', distance: 6, current: -1, risk: '退潮时向南顺流，涨潮时逆流' },
  { id: 'salt-crab', a: 'saltmere', b: 'crab', distance: 5, shallow: true, current: 0, risk: '红蟹群会在夜潮爬上浮标' },
  { id: 'crab-lantern', a: 'crab', b: 'lantern', distance: 5, current: 1, risk: '两岛之间有一条会拐弯的横流' },
  { id: 'lantern-brine', a: 'lantern', b: 'brinewatch', distance: 5, current: 0, risk: '灯塔视线清楚，但税船问话很细' },
  { id: 'crab-thorn', a: 'crab', b: 'thorn', distance: 3, current: 0, risk: '黑树影遮住航标' },
  { id: 'thorn-gull', a: 'thorn', b: 'gull', distance: 8, hidden: true, current: -1, risk: '暗礁航线，只有持有望远镜或海图才安全' },
  { id: 'lantern-gull', a: 'lantern', b: 'gull', distance: 4, shallow: true, current: 1, risk: '鸥群会在低潮遮住浅滩标记' }
];

export function routeBetween(a: string, b: string): Route | undefined {
  return ROUTES.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
}

export function neighborsOf(id: string): Route[] {
  return ROUTES.filter((r) => r.a === id || r.b === id);
}

export function otherEnd(route: Route, id: string): Island['id'] {
  return route.a === id ? route.b : route.a;
}

export const UPGRADES: Upgrade[] = [
  {
    id: 'almanac',
    name: '潮汐历',
    kind: 'tool',
    level: 0,
    maxLevel: 1,
    prices: [14],
    island: 'tidehome',
    description: '显示未来 6 小时精确潮高，出发前能算出浅滩窗口。'
  },
  {
    id: 'chronometer',
    name: '精密时计',
    kind: 'tool',
    level: 0,
    maxLevel: 1,
    prices: [28],
    island: 'lantern',
    description: '把航线预计时间从“大概”变为精确到小时。'
  },
  {
    id: 'spyglass',
    name: '铜望远镜',
    kind: 'tool',
    level: 0,
    maxLevel: 1,
    prices: [24],
    island: 'brinewatch',
    description: '看见暗礁航线；也能提前发现雾里的船和漂浮物。'
  },
  {
    id: 'pouch',
    name: '防水邮袋',
    kind: 'tool',
    level: 0,
    maxLevel: 1,
    prices: [18],
    island: 'saltmere',
    description: '风暴不会损坏信件；私拆机密时更不容易被发现。'
  },
  {
    id: 'cargo',
    name: '船舱隔板',
    kind: 'cargo',
    level: 0,
    maxLevel: 3,
    prices: [22, 36, 54],
    island: 'saltmere',
    description: '每级增加 3 单位载重。合理分装信件比把所有信袋堆上来得重要。'
  },
  {
    id: 'tank',
    name: '煤油柜',
    kind: 'tank',
    level: 0,
    maxLevel: 3,
    prices: [18, 32, 48],
    island: 'brinewatch',
    description: '每级增加 8 单位燃料容量。'
  },
  {
    id: 'engine',
    name: '蟹油机改装',
    kind: 'engine',
    level: 0,
    maxLevel: 3,
    prices: [26, 42, 64],
    island: 'crab',
    description: '每级让机航速度增加 1 海里/小时，但燃料消耗也会提高。'
  },
  {
    id: 'hull',
    name: '加固船壳',
    kind: 'hull',
    level: 0,
    maxLevel: 3,
    prices: [24, 40, 60],
    island: 'crab',
    description: '每级增加 1 点最大船壳，并让风暴伤害少一点。'
  },
  {
    id: 'sealkit',
    name: '火漆补封盒',
    kind: 'consumable',
    level: 0,
    maxLevel: 99,
    prices: [6],
    island: 'any',
    description: '消耗品。把一封已拆开的信重新封好，但收信人仍可能察觉折痕。'
  }
];

export const INITIAL_MAILS: Mail[] = [
  {
    id: 'm-salt-tax',
    from: 'tidehome',
    to: 'saltmere',
    title: '盐税暂缓通知',
    sender: '老局长莫恩',
    recipient: '盐泽代表阿澈',
    weight: 1,
    reward: 12,
    deadline: 30,
    secrecy: '公开',
    summary: '一张盖着总局印的通知单，纸角沾着盐粒。',
    body: '盐税暂延三日。请通知晒盐场不要在低潮时争抢泥脊。另：替我向阿澈问好。',
    status: 'available'
  },
  {
    id: 'm-salt-remedy',
    from: 'tidehome',
    to: 'saltmere',
    title: '潮湿药方',
    sender: '潮汐港药师',
    recipient: '盐工小穗',
    weight: 1,
    reward: 9,
    deadline: 36,
    secrecy: '普通',
    summary: '薄薄一张药方，写着烤蟹壳与海杉针的用量。',
    body: '咳得厉害时，用烤蟹壳粉半勺，海杉针煮水。别让盐工再喝潮沟里的积水。',
    status: 'available'
  },
  {
    id: 'm-crab-gong',
    from: 'tidehome',
    to: 'crab',
    title: '红蟹锣节拍',
    sender: '鼓手洛川',
    recipient: '蟹锣岛铜锣师',
    weight: 2,
    reward: 14,
    deadline: 48,
    secrecy: '普通',
    summary: '卷筒里画着奇怪的鼓点，边缘还压着一片红蟹壳。',
    body: '新节拍叫“退潮三声”。低潮后敲第一通，第二通留给黑树湾方向。第三通别急。',
    status: 'available'
  },
  {
    id: 'm-lantern-love',
    from: 'tidehome',
    to: 'lantern',
    title: '没有署名的蓝信封',
    sender: '匿名',
    recipient: '灯枝岛守灯人',
    weight: 1,
    reward: 18,
    deadline: 60,
    secrecy: '私密',
    summary: '蓝火漆上没有家族纹章，只有一片小小的灯芯印。',
    body: '若你还在第三盏灯下等我，我会随月潮回来。别把灯熄灭，哪怕税关问起。',
    status: 'available'
  },
  {
    id: 'm-brine-customs',
    from: 'tidehome',
    to: 'brinewatch',
    title: '关税季验船公文',
    sender: '邮政总局',
    recipient: '咸望堡税务官',
    weight: 2,
    reward: 18,
    deadline: 54,
    secrecy: '机密',
    summary: '系着黑白双色绳结的公文，封口压得很紧。',
    body: '第六潮汐周起，所有机帆船须登记煤油来源。棘木湾入港货物须开箱查验。',
    status: 'available'
  },
  {
    id: 'm-salt-crab-seed',
    from: 'saltmere',
    to: 'crab',
    title: '蟹苗换盐契',
    sender: '阿澈',
    recipient: '铜锣师',
    weight: 2,
    reward: 14,
    deadline: 78,
    secrecy: '普通',
    summary: '半张盐契，边缘用蟹钳印做记号。',
    body: '三筐蟹苗换八袋粗盐。若潮误了，就把契压在铜锣下，不要交给税关。',
    status: 'available'
  },
  {
    id: 'm-crab-thorn-drum',
    from: 'crab',
    to: 'thorn',
    title: '黑树湾鼓谱',
    sender: '铜锣师',
    recipient: '棘木湾引航员',
    weight: 1,
    reward: 20,
    deadline: 84,
    secrecy: '私密',
    summary: '鼓谱背面似乎画着几段航标线。',
    body: '三通鼓后，沿断桅向西。看见双鸟巢才转舵。若税船追问，就说这只是情歌。',
    status: 'available'
  },
  {
    id: 'm-thorn-gull-chart',
    from: 'thorn',
    to: 'gull',
    title: '油布海图碎片',
    sender: '引航员青棘',
    recipient: '鸥栖屿观潮老人',
    weight: 1,
    reward: 30,
    deadline: 96,
    secrecy: '机密',
    summary: '硬得像一块甲片，缝线里藏着细小红线。',
    body: '暗礁只在潮位低于 0.35 时露出三息。旧观潮台第七块石板下，有另半张图。',
    status: 'available'
  },
  {
    id: 'm-gull-tide-report',
    from: 'gull',
    to: 'tidehome',
    title: '观潮台异常记录',
    sender: '无名观潮员',
    recipient: '老局长莫恩',
    weight: 1,
    reward: 28,
    deadline: 120,
    secrecy: '机密',
    summary: '记录上每六个小时就画一个圈，最后一个圈被涂成黑色。',
    body: '第二回流没有消失，只是绕到了鸥栖屿背面。若黑圈连续出现三次，请封存外港邮件。',
    status: 'available'
  },
  {
    id: 'm-lantern-brine-seal',
    from: 'lantern',
    to: 'brinewatch',
    title: '灯塔灯罩清单',
    sender: '灯枝岛工坊',
    recipient: '咸望堡军需官',
    weight: 3,
    reward: 20,
    deadline: 90,
    secrecy: '公开',
    summary: '一整包玻璃清单，抱起来会发出轻微碰撞声。',
    body: '大号灯罩十二，防风灯罩二十。另有蓝玻璃三片，按旧约不列入税目。',
    status: 'available'
  },
  {
    id: 'm-brine-mayor',
    from: 'brinewatch',
    to: 'brinewatch',
    title: '税务官的晚宴短笺',
    sender: '税务官费恩',
    recipient: '咸望堡市长',
    weight: 1,
    reward: 16,
    deadline: 72,
    secrecy: '私密',
    summary: '信封很干净，但收寄双方都在同一座堡垒里。',
    body: '我知道灯塔清单少了三片蓝玻璃。晚宴后让邮差从侧门进来，价格好商量。',
    status: 'available'
  },
  {
    id: 'm-thorn-salt-promise',
    from: 'thorn',
    to: 'saltmere',
    title: '没有邮戳的还钱信',
    sender: '青棘',
    recipient: '阿澈',
    weight: 1,
    reward: 18,
    deadline: 108,
    secrecy: '私密',
    summary: '里面摸起来像有一枚硬币，但信封厚得反常。',
    body: '欠你的盐钱藏在蜡丸里。若邮差把信交给别人，黑树湾以后只认夜潮。',
    status: 'available'
  },
  {
    id: 'm-crab-festival',
    from: 'crab',
    to: 'tidehome',
    title: '红蟹节请柬',
    sender: '铜锣师',
    recipient: '邮政总局全员',
    weight: 2,
    reward: 16,
    deadline: 112,
    secrecy: '公开',
    summary: '红色请柬散发着烤蟹壳和甜酱的味道。',
    body: '第六日涨潮开宴。请总局派一位还记得第一通鼓怎么敲的人来。',
    status: 'available'
  },
  {
    id: 'm-lantern-gull-parts',
    from: 'lantern',
    to: 'gull',
    title: '微型齿轮包',
    sender: '守灯人',
    recipient: '观潮老人',
    weight: 2,
    reward: 24,
    deadline: 100,
    secrecy: '普通',
    summary: '小纸包里有细碎金属声，像一只会呼吸的钟。',
    body: '旧时计的擒纵轮已配好。请不要再用潮汐声给自己对时了，慢了七分钟。',
    status: 'available'
  },
  {
    id: 'm-tide-will',
    from: 'tidehome',
    to: 'tidehome',
    title: '莫恩的封好遗嘱',
    sender: '老局长莫恩',
    recipient: '继任局长（暂由邮差保管）',
    weight: 1,
    reward: 0,
    deadline: 126,
    secrecy: '机密',
    special: 'will',
    summary: '老局长要求这封信在本轮邮班结束前不要离船，也不要被拆开。',
    body: '若你读到这里，说明我没能等到下一次平潮。潮汐港不是起点，也不是终点；抽屉后的铜牌留给愿意记得所有人的邮差。',
    status: 'available'
  }
];

export const GENERIC_MAIL_TEMPLATES = [
  {
    suffix: '家书',
    secrecy: '普通' as const,
    weight: 1,
    reward: 8,
    window: [30, 54] as [number, number],
    summary: '普通家书，纸角有被家人反复摸过的折痕。',
    body: '潮水若顺路，就替我看看他们是否还平安。家里的门闩记得上油。'
  },
  {
    suffix: '账单',
    secrecy: '公开' as const,
    weight: 1,
    reward: 7,
    window: [28, 48] as [number, number],
    summary: '一张字体刻板的账单。',
    body: '请于本轮潮邮结束前结清煤油、绳缆与干饼账款。逾期恕不赊欠。'
  },
  {
    suffix: '情诗',
    secrecy: '私密' as const,
    weight: 1,
    reward: 11,
    window: [36, 66] as [number, number],
    summary: '带着淡淡灯油味的小诗。',
    body: '你问我何时归来？我说等潮学会倒流。可每个夜里，潮都在向你倒流。'
  },
  {
    suffix: '密报',
    secrecy: '机密' as const,
    weight: 1,
    reward: 18,
    window: [42, 72] as [number, number],
    summary: '没有署名，折法却像税关训练过的样子。',
    body: '黑树湾的货在第三盏灯下换船。不要记录我的名字，也不要相信鼓谱。'
  }
];
