import Phaser from 'phaser';
import { MAP_H, MAP_W, MAX_HOUR, ROUTES, ISLAND_MAP, otherEnd, routeBetween } from '../data';
import {
  acceptedMails,
  canDiscard,
  cargoMax,
  cargoUsed,
  changeRelation,
  clamp,
  clockOf,
  createState,
  dayOf,
  deliverAtIsland,
  discardMail,
  endingScore,
  endingTitle,
  estimateVoyage,
  fuelMax,
  hasSave,
  islandName,
  loadGame,
  log,
  makeRng,
  marketRate,
  openMail,
  outgoingAt,
  priceOf,
  repairCost,
  resealMail,
  routesFrom,
  saveGame,
  SAVE_KEY,
  secrecyDanger,
  shallowOpen,
  spawnDailyMail,
  tideAt,
  tideLabel,
  voyageMoveAt,
  VOYAGE_STEP_HOURS,
  availableAtIsland,
  backupFileName,
  clearSave,
  createBackup,
  parseBackupText
} from '../engine';
import { eventChoicesFor, getForcedRouteEvent, getPortEvent, pickRouteEvent } from '../events';
import type {
  GameEvent,
  GameState,
  IslandId,
  Mail,
  Route,
  RunMemory,
  EventOutcome,
  TravelMode,
  Weather
} from '../types';

type Tab = 'port' | 'mail' | 'ship' | 'log' | 'memory' | 'help';

interface ModalButton {
  label: string;
  onClick: () => void;
  disabled?: string;
  primary?: boolean;
  danger?: boolean;
}

const COLORS = {
  ink: '#eaf7f4',
  dim: '#a9c7c4',
  faint: '#6f8f91',
  gold: '#f1d18a',
  teal: '#62d5d0',
  blue: '#9cc9ff',
  red: '#ff8b7a',
  green: '#9ee8a8',
  panel: 0x0e2c3b,
  panel2: 0x12384a,
  line: 0x315b68,
  map: 0x092636,
  dark: 0x071b2a
};

export class GameScene extends Phaser.Scene {
  private state: GameState | null = null;
  private root!: Phaser.GameObjects.Container;
  private layer!: Phaser.GameObjects.Container;
  private overlayLayer!: Phaser.GameObjects.Container;
  private tab: Tab = 'port';
  private selectedRouteId: string | null = null;
  private travelMode: TravelMode = 'sail';
  private selectedMailId: string | null = null;
  private selectedMemoryId: string | null = null;
  private memoryLogPage = 0;
  private mailListPage = 0;
  private modalOpen = false;
  private notices: string[] = [];
  private noticeRef: Phaser.GameObjects.Container | null = null;
  /** 恢复确认弹窗等待写入的备份文本；确认时会重新解析校验，而不是信任已展示的对象。 */
  private pendingBackupText: string | null = null;
  /** 到港后自动弹出港口事件的延时句柄；玩家提前手动处理或离港时必须取消，防止旧事件二次弹出。 */
  private pendingPortEventTimer: Phaser.Time.TimerEvent | null = null;
  private rng: () => number = Math.random;
  private mapScale = 1;
  private mapOffsetX = 24;
  private mapOffsetY = 86;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.root = this.add.container(0, 0);
    this.layer = this.add.container(0, 0);
    this.overlayLayer = this.add.container(0, 0);
    this.root.add([this.layer, this.overlayLayer]);

    this.scale.on('resize', this.layout, this);
    this.layout();

    this.time.addEvent({
      // 每个 tick 推进半个时辰（VOYAGE_STEP_HOURS）：与预估模拟同粒度，保持约 1 游戏小时/秒的时钟速度。
      delay: 500,
      loop: true,
      callback: this.tickTravel,
      callbackScope: this
    });

    this.time.addEvent({
      delay: 4200,
      loop: true,
      callback: () => {
        if (this.notices.length > 1) {
          this.notices.shift();
          this.render();
        }
      }
    });

    this.renderTitle();
  }

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const s = Math.min(w / 1280, h / 720);
    this.mapScale = s;
    this.root.setScale(s);
    this.root.setPosition((w - 1280 * s) / 2, (h - 720 * s) / 2);
    this.cameras.main.setBackgroundColor('#04101a');
    this.render();
  }

  private s(): GameState {
    if (!this.state) throw new Error('Game state missing');
    return this.state;
  }

  private clearLayer(layer: Phaser.GameObjects.Container): void {
    layer.removeAll(true);
  }

  private render(): void {
    if (!this.state) {
      this.renderTitle();
      return;
    }
    this.clearLayer(this.layer);
    this.drawBackground();
    this.drawMap();
    this.drawTopBar();
    this.drawRightPanel();
    this.drawNotice();
  }

  private renderTitle(): void {
    this.state = null;
    this.clearLayer(this.layer);
    this.clearLayer(this.overlayLayer);
    const g = this.add.graphics();
    this.layer.add(g);
    g.fillGradientStyle(0x061b2a, 0x061b2a, 0x0b3948, 0x082436, 1);
    g.fillRect(0, 0, 1280, 720);

    for (let i = 0; i < 90; i += 1) {
      const x = (i * 137) % 1280;
      const y = (i * 83) % 720;
      g.fillStyle(0xdaf4ef, 0.035 + (i % 5) * 0.01);
      g.fillCircle(x, y, 1 + (i % 3) * 0.4);
    }

    for (let i = 0; i < 7; i += 1) {
      g.lineStyle(1, 0x7ed6d2, 0.05);
      g.beginPath();
      const y = 110 + i * 88;
      for (let x = 0; x <= 1280; x += 20) {
        g.lineTo(x, y + Math.sin((x + i * 70) / 75) * 18);
      }
      g.strokePath();
    }

    this.text(640, 120, '潮汐邮局', { fontSize: '62px', color: COLORS.gold, fontStyle: 'bold' }).setOrigin(0.5);
    this.text(640, 184, '一艘只能随潮汐航行的邮船 · 群岛信件与多周目记忆', { fontSize: '22px', color: COLORS.dim }).setOrigin(0.5);

    this.panel(290, 240, 700, 392, 0x0b2534, 0x5b9ca5, 0.75);
    this.text(330, 268, '六日潮邮', { fontSize: '26px', color: COLORS.teal, fontStyle: 'bold' });
    this.text(330, 310, [
      '· 你不可能一次带走所有信：载重、期限、燃料与潮窗都要取舍。',
      '· 私拆、抛弃或延误信件会改变七座岛的关系，开启不同分支。',
      '· 改造船舱、煤油柜、引擎和船壳；购买潮汐历、时计与望远镜。',
      '· 每个轮次约 20 分钟；结局、秘密和关系会写入下一周目的航海日志。'
    ].join('\n'), { fontSize: '20px', color: COLORS.ink, lineSpacing: 10, wordWrap: { width: 620 } });

    const saveExists = hasSave();
    this.button(405, 442, 210, 50, '开始第一轮潮邮', () => this.startNewGame(1, []), { primary: true });
    this.button(665, 442, 210, 50, saveExists ? '读取本地存档' : '没有本地存档', () => this.continueGame(), {
      disabled: saveExists ? undefined : '本地浏览器暂无存档'
    });
    this.button(405, 504, 210, 42, saveExists ? '导出备份文件' : '没有可导出的存档', () => this.exportTitleBackup(), {
      disabled: saveExists ? undefined : '先完成或保存一局，再导出备份'
    });
    this.button(665, 504, 210, 42, '从备份文件恢复', () => this.chooseBackupFile(), {});
    this.button(535, 558, 210, 38, '删除本地存档', () => {
      clearSave();
      this.renderTitle();
    }, { danger: true });

    this.text(640, 606, '备份是单个 .json 文件：结局摘要与最多十轮的旧航行日志都在其中，可拷贝到其他设备或离线保存。', {
      fontSize: '14px',
      color: COLORS.faint
    }).setOrigin(0.5);
    this.text(640, 648, '建议首次流程：先带盐税、药方、红蟹锣谱、蓝情书和关税公文；低潮时等待约 2 小时再出航。', {
      fontSize: '17px',
      color: COLORS.faint
    }).setOrigin(0.5);
  }

  private continueGame(): void {
    const loaded = loadGame();
    if (!loaded) {
      const rawExists = (() => {
        try { return Boolean(localStorage.getItem(SAVE_KEY)); } catch { return false; }
      })();
      this.showAlert(
        '没有可读取的存档',
        rawExists
          ? '浏览器槽位里有数据，但内容已损坏、无法通过校验。\n请删除后重新开始，或从备份文件恢复。'
          : '浏览器里没有本地存档。'
      );
      return;
    }
    this.enterState(loaded);
    this.toast(loaded.ended ? '已读取本轮结束后的存档。' : '存档已读取。');
    if (!loaded.flags.introShown) this.showIntro();
  }

  // -------------------------------------------------------------------------
  // 可携带备份：导出为单个 .json 文件；恢复时读文件、确认摘要后覆盖 localStorage。
  // -------------------------------------------------------------------------

  /** 标题界面导出：读取 localStorage 里的存档，不改动它。 */
  private exportTitleBackup(): void {
    const loaded = loadGame();
    if (!loaded) {
      this.showAlert('无法导出', '本地没有能通过校验的完整存档；请先开始并保存一局。');
      return;
    }
    this.downloadBackup(loaded);
  }

  /** 游戏内导出：直接使用内存中的最新状态（含刚完成的结局记忆）。 */
  private exportCurrentBackup(): void {
    this.downloadBackup(this.s());
    this.toast('备份文件已开始下载，请妥善保存。');
  }

  private downloadBackup(state: GameState): void {
    const envelope = createBackup(state);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(envelope);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private chooseBackupFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.handleBackupText(String(reader.result ?? ''), file.name);
      // 标题页 toast 不可见，所有读文件失败统一走模态告警。
      reader.onerror = () => this.showAlert('读取失败', '浏览器没能读出这个文件，请重试或换一份备份。');
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
  }

  private handleBackupText(text: string, fileName: string): void {
    const result = parseBackupText(text);
    if (!result.ok) {
      // 关键：校验失败时绝不动 localStorage，现有进度保持原样。
      this.showAlert('备份无法使用', `${result.error}\n\n现有本地存档未被改动。`);
      return;
    }
    this.pendingBackupText = text;
    this.confirmRestore(result.state, result.envelope.at, fileName);
  }

  private confirmRestore(state: GameState, exportedAt: string, fileName: string): void {
    const exportedLabel = exportedAt.slice(0, 16).replace('T', ' ');
    const runStatus = state.ended ? '本轮已结束' : `第 ${state.cycle} 周目进行中`;
    const body = [
      `文件：${fileName}`,
      `备份时间：${exportedLabel}`,
      `内容：第 ${state.cycle} 周目 · ${runStatus} · 银币 ${state.silver}`,
      `归档结局：${state.memories.length} 轮（最多保留 10 轮，含每轮日志快照）`,
      '',
      '恢复会把该备份完整写入浏览器存档槽位，当前浏览器中的进度与多周目记忆将被覆盖。',
      '如需保留现有进度，请先点“取消”，在记忆页导出当前存档。'
    ].join('\n');

    if (this.modalOpen) this.closeOverlay();
    this.openModal({
      width: 720,
      height: 420,
      title: '从备份文件恢复？',
      body,
      buttons: [
        { label: '取消', onClick: () => { this.pendingBackupText = null; this.closeOverlay(); } },
        {
          label: '覆盖并恢复',
          danger: true,
          primary: true,
          onClick: () => this.restoreFromBackup()
        }
      ]
    });
  }

  /**
   * 恢复备份的安全写盘：
   * 1. 用确认弹窗保留的原文重新解析（不信任之前留在内存里的对象）；
   * 2. 备份当前 localStorage 原文，写入后立即回读并完整校验；
   * 3. 回读失败则恢复旧槽位；旧槽位也无效时至少清掉坏数据，避免游戏卡在残缺状态。
   */
  private restoreFromBackup(): void {
    const text = this.pendingBackupText;
    this.pendingBackupText = null;
    if (text === null) {
      this.showAlert('恢复中止', '备份内容已失效，请重新选择文件。');
      return;
    }
    const reparsed = parseBackupText(text);
    if (!reparsed.ok) {
      this.showAlert('恢复中止', `${reparsed.error}\n\n现有本地存档未被改动。`);
      return;
    }

    const previousRaw = (() => {
      try { return localStorage.getItem(SAVE_KEY); } catch { return null; }
    })();
    const hadLiveState = this.state !== null;

    try {
      // 槽位只存裸 state（不是备份信封）；saveGame 会更新 lastSave。
      saveGame(reparsed.state);
    } catch (err) {
      this.showAlert('恢复失败', `浏览器拒绝写入存档（可能存储空间不足）：\n${String(err)}\n\n现有进度未被改动。`);
      return;
    }

    const reread = loadGame();
    if (!reread) {
      // 写进去的数据回读校验不过：优先恢复旧槽位，绝不让残缺数据留在槽位里。
      try {
        if (previousRaw !== null) localStorage.setItem(SAVE_KEY, previousRaw);
        else localStorage.removeItem(SAVE_KEY);
      } catch {
        // 回滚也失败时交给后续分支清理。
      }
      const rollbackOk = previousRaw !== null && loadGame() !== null;
      if (rollbackOk) {
        this.showAlert('恢复已撤销', '备份写入后未能通过回读校验，已恢复为原来的本地存档。');
        return;
      }
      // 旧存档本身也已损坏：清槽并回到标题，保证界面始终可用。
      try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
      this.closeOverlay();
      this.renderTitle();
      this.showAlert('恢复失败', '该备份与原槽位数据都无法通过校验。坏数据已清除，可重新选择备份或开始新游戏。');
      return;
    }

    this.closeOverlay();
    if (hadLiveState) {
      this.enterState(reread);
    } else {
      this.state = reread;
      this.rng = makeRng(reread.seed + reread.hour * 13 + 77);
      this.selectedMailId = null;
      this.selectedRouteId = null;
      this.selectedMemoryId = null;
      this.memoryLogPage = 0;
    }
    this.tab = 'memory';
    this.render();
    this.toast(`已恢复第 ${reread.cycle} 周目存档与 ${reread.memories.length} 轮旧记忆。`);
  }

  /**
   * 模态告警：标题页（state 为 null）toast 不会渲染，
   * 文件解析/读盘失败必须用 overlay 弹窗，否则玩家看不到任何反馈。
   */
  private showAlert(title: string, body: string): void {
    if (this.modalOpen) this.closeOverlay();
    this.openModal({
      width: 640,
      height: 320,
      title,
      body,
      buttons: [{ label: '知道了', primary: true, onClick: () => this.closeOverlay() }]
    });
  }

  /** 载入一份状态（继续游戏或备份恢复共用）：同步随机数与分页选择。 */
  private enterState(loaded: GameState): void {
    this.state = loaded;
    this.rng = makeRng(loaded.seed + loaded.hour * 13 + 77);
    this.tab = 'port';
    this.selectedMailId = null;
    this.selectedRouteId = null;
    this.selectedMemoryId = null;
    this.memoryLogPage = 0;
    this.closeOverlay();
  }

  private startNewGame(cycle: number, memories: RunMemory[]): void {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    this.state = createState(cycle, memories, seed);
    this.state.started = true;
    this.rng = makeRng(seed);
    this.tab = 'port';
    this.selectedMailId = null;
    this.selectedRouteId = null;
    this.closeOverlay();
    saveGame(this.state);
    this.showIntro();
  }

  private showIntro(): void {
    const st = this.s();
    this.openModal({
      width: 900,
      height: 560,
      title: `第 ${st.cycle} 轮潮邮 · 退潮针号`,
      body: [
        '六天内，潮水会带着邮船穿过七座岛。你要决定哪些信上船、哪些信留下。',
        '',
        '初始目标（约 20 分钟）：',
        '1. 在潮汐港邮局接 4～5 封，注意载重上限为 8。',
        '2. 现在是低潮，前往盐泽礁的浅滩航线暂不可扬帆；等到 08:00 左右再出发。',
        '3. 盐泽礁 → 蟹锣岛 → 灯枝岛 → 咸望堡，沿途会遇到潮汐课、风暴和分支事件。',
        '4. 机密信不要私拆；普通、私密、机密信件被拆后的后果不同。',
        '',
        '时间会在等待与航行时流逝。每个港口操作后会自动保存到浏览器 localStorage。'
      ].join('\n'),
      buttons: [
        {
          label: '解开缆绳',
          primary: true,
          onClick: () => {
            st.flags.introShown = true;
            this.closeOverlay();
            log(st, '航行', '退潮针号解缆，第一轮潮邮正式开始。');
            st.flags.introShown = true;
            saveGame(st);
            this.render();
          }
        }
      ]
    });
  }

  private drawBackground(): void {
    const g = this.add.graphics();
    this.layer.add(g);
    g.fillStyle(COLORS.dark, 1).fillRect(0, 0, 1280, 720);
    g.fillStyle(0x092637, 1).fillRoundedRect(14, 82, 670, 624, 18);
    g.fillStyle(0x0c3142, 1).fillRoundedRect(700, 82, 566, 624, 18);
    g.lineStyle(1, 0x244a58, 0.8).strokeRoundedRect(14, 82, 670, 624, 18);
    g.lineStyle(1, 0x244a58, 0.8).strokeRoundedRect(700, 82, 566, 624, 18);
  }

  private drawTopBar(): void {
    const st = this.s();
    this.panel(14, 10, 1252, 62, 0x0d2d3d, 0x386978);
    this.text(34, 27, '潮汐邮局', { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' });
    this.text(34, 55, `第 ${st.cycle} 周目`, { fontSize: '13px', color: COLORS.faint });

    const tide = tideAt(st.hour, this.currentWeather());
    this.text(178, 26, clockOf(st.hour), { fontSize: '21px', color: COLORS.ink, fontStyle: 'bold' });
    this.text(178, 54, `${tideLabel(tide)} ${st.tools.almanac ? tide.toFixed(2) : '（无潮汐历）'}`, { fontSize: '14px', color: tide > 0.65 ? COLORS.green : tide < 0.35 ? COLORS.red : COLORS.dim });

    for (let i = 0; i < 12; i += 1) {
      const h = st.hour + i * 0.5;
      const v = tideAt(h, this.currentWeather());
      const x = 326 + i * 16;
      const barH = 4 + v * 24;
      const g = this.add.graphics();
      this.layer.add(g);
      g.fillStyle(v >= 0.35 ? 0x4bc9c4 : 0xe07969, st.tools.almanac ? 0.9 : 0.18);
      g.fillRect(x, 56 - barH, 10, barH);
    }
    this.text(326, 18, st.tools.almanac ? '未来 6 小时潮位' : '购买潮汐历后显示潮位', { fontSize: '12px', color: COLORS.faint });

    this.stat(550, '位置', islandName(st.at));
    this.stat(704, '银币', `${st.silver}`);
    this.stat(806, '燃料', `${st.fuel.toFixed(1)}/${fuelMax(st)}`);
    this.stat(948, '船舱', `${cargoUsed(st)}/${cargoMax(st)}`);
    this.stat(1066, '船壳', `${st.hull}/${st.maxHull}`);

    this.button(1168, 21, 78, 38, '保存', () => {
      saveGame(st);
      this.toast('已手动保存到浏览器。');
    });
  }

  private currentWeather(): Weather {
    return st_safe(this.state)?.travel.active ? this.s().travel.weather : 'clear';
  }

  private stat(x: number, label: string, value: string): void {
    this.text(x, 24, value, { fontSize: '18px', color: COLORS.ink, fontStyle: 'bold' });
    this.text(x, 50, label, { fontSize: '12px', color: COLORS.faint });
  }

  private mapPoint(id: IslandId): { x: number; y: number } {
    const island = ISLAND_MAP[id];
    return { x: this.mapOffsetX + island.x * this.mapContentScale(), y: this.mapOffsetY + island.y * this.mapContentScale() };
  }

  private mapContentScale(): number {
    return Math.min((MAP_W + 20) / MAP_W, (MAP_H + 20) / MAP_H);
  }

  private drawMap(): void {
    const st = this.s();
    const g = this.add.graphics();
    this.layer.add(g);
    g.fillStyle(0x082333, 1).fillRoundedRect(22, 90, 654, 608, 14);

    // Decorative soundings.
    for (let i = 0; i < 70; i += 1) {
      const x = 38 + ((i * 97) % 620);
      const y = 108 + ((i * 61) % 570);
      g.fillStyle(0xbfe9e6, 0.035);
      g.fillCircle(x, y, 1.2);
    }

    for (const route of ROUTES) {
      const visible = !route.hidden || st.tools.spyglass || st.flags.hiddenChartKnown;
      const p1 = this.mapPoint(route.a);
      const p2 = this.mapPoint(route.b);
      const selected = this.selectedRouteId === route.id;
      if (!visible) {
        g.lineStyle(1, 0x587b83, 0.18);
        g.beginPath();
        g.moveTo(p1.x, p1.y);
        g.lineTo(p2.x, p2.y);
        g.strokePath();
        continue;
      }
      const shallow = route.shallow;
      const tide = tideAt(st.hour, this.currentWeather());
      const color = route.hidden ? 0xd9b66d : shallow ? (tide >= 0.35 ? 0x6bd6c9 : 0xe3796b) : 0x7ca9b6;
      g.lineStyle(selected ? 5 : 3, color, selected ? 1 : 0.72);
      g.beginPath();
      g.moveTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.strokePath();

      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      g.fillStyle(0x082333, 0.78).fillCircle(mx, my, 22);
      g.lineStyle(1, color, 0.7).strokeCircle(mx, my, 22);
      this.text(mx, my - 8, `${route.distance}海里`, { fontSize: '11px', color: COLORS.dim }).setOrigin(0.5);
      if (route.shallow) this.text(mx, my + 8, tide >= 0.35 ? '浅滩开放' : '浅滩封闭', { fontSize: '10px', color: tide >= 0.35 ? COLORS.green : COLORS.red }).setOrigin(0.5);
      if (route.hidden) this.text(mx, my + 8, '暗礁', { fontSize: '10px', color: COLORS.gold }).setOrigin(0.5);
    }

    for (const island of Object.values(ISLAND_MAP)) {
      const p = this.mapPoint(island.id);
      const relation = st.relations[island.id];
      const active = st.at === island.id;
      g.fillStyle(0x061a27, 0.72).fillCircle(p.x + 3, p.y + 4, 27);
      g.fillStyle(island.color, active ? 1 : 0.82).fillCircle(p.x, p.y, active ? 25 : 21);
      g.lineStyle(2, active ? 0xfff0b5 : 0x0a2433, 0.9).strokeCircle(p.x, p.y, active ? 25 : 21);
      this.text(p.x, p.y - 2, island.name, { fontSize: '12px', color: '#17313d', fontStyle: 'bold' }).setOrigin(0.5);
      this.text(p.x, p.y + 13, `${relation} ${relation >= 70 ? '♥' : relation <= 30 ? '!' : ''}`, { fontSize: '10px', color: '#17313d' }).setOrigin(0.5);
      if (getPortEvent(st, island.id) && st.at === island.id) {
        g.fillStyle(0xff7668, 1).fillCircle(p.x + 22, p.y - 22, 7);
      }
      if (acceptedMails(st).some((m) => m.to === island.id)) {
        g.fillStyle(0xffe08a, 1).fillCircle(p.x - 23, p.y - 19, 5);
      }
    }

    // Ship.
    const moving = st.travel.active;
    let sx = 0;
    let sy = 0;
    if (moving) {
      const route = ROUTES.find((r) => r.id === st.travel.routeId) ?? routeBetween(st.travel.from, st.travel.to);
      const p1 = this.mapPoint(st.travel.from);
      const p2 = this.mapPoint(st.travel.to);
      const t = clamp(st.travel.progress / Math.max(1, st.travel.total), 0, 1);
      sx = Phaser.Math.Linear(p1.x, p2.x, t);
      sy = Phaser.Math.Linear(p1.y, p2.y, t);
      if (route) {
        const angle = Phaser.Math.Angle.Between(p1.x, p1.y, p2.x, p2.y);
        g.lineStyle(2, 0xf2d58e, 0.4);
        g.beginPath();
        g.moveTo(p1.x, p1.y);
        g.lineTo(p2.x, p2.y);
        g.strokePath();
        this.drawBoat(g, sx, sy, angle);
      }
    } else {
      const p = this.mapPoint(st.at);
      sx = p.x;
      sy = p.y + 34;
      this.drawBoat(g, sx, sy, -Math.PI / 2);
    }

    if (st.travel.weather === 'storm') this.text(350, 118, '风暴中', { fontSize: '24px', color: COLORS.red, fontStyle: 'bold' }).setOrigin(0.5);
    if (st.travel.weather === 'fog') this.text(350, 118, '白雾中', { fontSize: '24px', color: COLORS.dim, fontStyle: 'bold' }).setOrigin(0.5);

    this.text(349, 674, '实线：可确认航线　红/青：浅滩潮况　虚线：尚未识别的暗礁航线', {
      fontSize: '13px',
      color: COLORS.faint
    }).setOrigin(0.5);
  }

  private drawBoat(g: Phaser.GameObjects.Graphics, x: number, y: number, angle: number): void {
    g.save();
    g.translateCanvas(x, y);
    g.rotateCanvas(angle + Math.PI / 2);
    g.fillStyle(0xf4d79d, 1);
    g.fillTriangle(-9, 10, 9, 10, 0, -17);
    g.fillStyle(0x7de0dc, 1);
    g.fillTriangle(0, -15, 0, 5, 10, 0);
    g.fillStyle(0x563b2d, 1);
    g.fillRect(-12, 8, 24, 7);
    g.restore();
  }

  private drawRightPanel(): void {
    const tabs: Array<[Tab, string]> = [
      ['port', '港口'],
      ['mail', '信件'],
      ['ship', '船舶'],
      ['log', '日志'],
      ['memory', '记忆'],
      ['help', '帮助']
    ];
    tabs.forEach(([id, label], i) => {
      this.button(712 + i * 90, 94, 82, 34, label, () => {
        this.tab = id;
        this.render();
      }, { primary: this.tab === id, small: true });
    });

    if (this.s().ended) {
      this.text(980, 145, '本轮已结束', { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' }).setOrigin(0.5);
      this.button(910, 180, 140, 38, '查看结局', () => this.reopenEnding(), { primary: true });
    }

    if (this.tab === 'port') this.drawPortTab();
    if (this.tab === 'mail') this.drawMailTab();
    if (this.tab === 'ship') this.drawShipTab();
    if (this.tab === 'log') this.drawLogTab();
    if (this.tab === 'memory') this.drawMemoryTab();
    if (this.tab === 'help') this.drawHelpTab();
  }

  private drawPortTab(): void {
    const st = this.s();
    const island = ISLAND_MAP[st.at];
    const traveling = st.travel.active;
    const y0 = traveling ? 142 : 140;
    this.text(724, y0, island.name, { fontSize: '28px', color: COLORS.gold, fontStyle: 'bold' });
    this.text(724, y0 + 28, island.alias, { fontSize: '15px', color: COLORS.faint });
    this.paragraph(724, y0 + 58, 520, traveling ? '退潮针号正在海上。到达前不能装卸邮件、改造或补给。' : island.description, {
      fontSize: '15px',
      color: COLORS.dim,
      lineSpacing: 5
    });

    if (traveling) {
      this.drawTravelStatus();
      return;
    }

    const portEvent = getPortEvent(st, st.at);
    if (portEvent) {
      this.panel(724, 250, 518, 74, 0x3a2332, 0xd78392);
      this.text(742, 268, `事件：${portEvent.title}`, { fontSize: '16px', color: '#ffd0d8', fontStyle: 'bold' });
      this.button(1086, 267, 138, 38, '前往处理', () => {
        // 玩家主动处理：取消到港时安排的自动弹窗，避免同一事件被打开两次、重复结算。
        this.clearPendingPortEventTimer();
        this.openGameEvent(portEvent, { island: st.at });
      }, { primary: true });
      this.text(742, 298, '处理事件前也可以先交付信件或等待潮窗。', { fontSize: '12px', color: COLORS.dim });
    }

    this.button(724, 342, 118, 36, '等 1 小时', () => this.passTime(1), { small: true });
    this.button(852, 342, 150, 36, '等到下次涨潮', () => this.waitForTide(), { small: true });
    this.text(1020, 360, `潮位 ${tideAt(st.hour).toFixed(2)}`, { fontSize: '13px', color: COLORS.faint });

    const routes = routesFrom(st, st.at);
    this.text(724, 405, '选择航线', { fontSize: '19px', color: COLORS.teal, fontStyle: 'bold' });
    routes.forEach((route, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 724 + col * 262;
      const y = 435 + row * 78;
      const to = otherEnd(route, st.at);
      const selected = this.selectedRouteId === route.id;
      this.panel(x, y, 246, 64, selected ? 0x16485a : 0x0f3344, selected ? 0x76e0d8 : 0x315b68);
      this.button(x, y, 246, 64, '', () => {
        this.selectedRouteId = route.id;
        this.render();
      }, {});
      this.text(x + 12, y + 13, `→ ${islandName(to)}`, { fontSize: '16px', color: COLORS.ink, fontStyle: 'bold' });
      this.text(x + 12, y + 36, `${route.distance}海里${route.shallow ? ' · 浅滩' : ''}${route.hidden ? ' · 暗礁' : ''}`, { fontSize: '12px', color: COLORS.faint });
      const estSail = estimateVoyage(st, route, st.at, 'sail');
      this.text(x + 150, y + 35, st.tools.chronometer ? `${estSail.hours}h` : `约${Math.ceil(estSail.hours)}h`, {
        fontSize: '14px',
        color: estSail.blocked ? COLORS.red : COLORS.green
      });
    });

    const selected = this.selectedRoute();
    if (selected) this.drawVoyageControls(selected);
  }

  private drawTravelStatus(): void {
    const st = this.s();
    const t = st.travel;
    const remaining = Math.max(0, t.total - t.progress);
    this.panel(724, 250, 518, 172, 0x102f42, 0x457d8f);
    this.text(744, 274, `${islandName(t.from)} → ${islandName(t.to)}`, { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' });
    this.text(744, 309, `${t.mode === 'sail' ? '扬帆随潮' : '机帆航行'} · ${t.progress.toFixed(1)}/${t.total.toFixed(1)} 海里`, {
      fontSize: '16px',
      color: COLORS.ink
    });
    this.text(744, 338, `剩余约 ${remaining.toFixed(1)} 海里 · 计划燃料 ${t.fuelPlanned.toFixed(1)} · ${t.weather === 'clear' ? '晴浪' : t.weather === 'fog' ? '雾' : '风暴'}`, {
      fontSize: '13px',
      color: COLORS.dim
    });
    const g = this.add.graphics();
    this.layer.add(g);
    g.fillStyle(0x081f2c, 1).fillRoundedRect(744, 366, 456, 18, 8);
    g.fillStyle(0x65d6cf, 1).fillRoundedRect(744, 366, 456 * clamp(t.progress / Math.max(1, t.total), 0, 1), 18, 8);
    this.text(744, 402, t.paused ? '事件正在等待决定，航行暂停。' : '时间正在流逝，潮位会改变航速。', { fontSize: '12px', color: COLORS.faint });
  }

  private selectedRoute(): Route | null {
    if (!this.selectedRouteId) return null;
    return ROUTES.find((r) => r.id === this.selectedRouteId) ?? null;
  }

  private drawVoyageControls(route: Route): void {
    const st = this.s();
    const to = otherEnd(route, st.at);
    const sail = estimateVoyage(st, route, st.at, 'sail');
    const motor = estimateVoyage(st, route, st.at, 'motor');
    const est = this.travelMode === 'sail' ? sail : motor;

    this.panel(724, 596, 518, 92, 0x103343, 0x3e7587);
    this.text(742, 615, `前往${islandName(to)}`, { fontSize: '17px', color: COLORS.ink, fontStyle: 'bold' });
    this.text(742, 641, this.estimateText(route, est, 'sail' === this.travelMode), {
      fontSize: '13px',
      color: est.blocked ? COLORS.red : COLORS.dim,
      wordWrap: { width: 350 }
    });
    this.button(985, 610, 92, 30, this.travelMode === 'sail' ? '✓ 扬帆' : '扬帆', () => {
      this.travelMode = 'sail';
      this.render();
    }, { small: true, primary: this.travelMode === 'sail' });
    this.button(1084, 610, 92, 30, this.travelMode === 'motor' ? '✓ 机帆' : '机帆', () => {
      this.travelMode = 'motor';
      this.render();
    }, { small: true, primary: this.travelMode === 'motor' });
    this.button(1084, 650, 126, 30, '解缆出航', () => this.startVoyage(route, this.travelMode), {
      small: true,
      primary: true,
      disabled: est.blocked
    });
  }

  private estimateText(route: Route, est: ReturnType<typeof estimateVoyage>, sailMode: boolean): string {
    const exact = this.s().tools.chronometer;
    const time = exact ? `${est.hours}小时` : `约${Math.ceil(est.hours)}小时`;
    const shallow = route.shallow ? ` 最低潮${est.minTide.toFixed(2)}` : '';
    const fuel = sailMode ? '不耗燃料' : `燃料≈${est.fuel.toFixed(1)}`;
    return `${time} · ${fuel}${shallow}${est.blocked ? ` · ${est.blocked}` : ''}`;
  }

  private drawMailTab(): void {
    const st = this.s();
    const currentOut = outgoingAt(st, st.at);
    const carried = acceptedMails(st);
    const records = st.mails.filter((m) => ['delivered', 'returned', 'discarded'].includes(m.status));
    const list = this.tab === 'mail' ? [...currentOut, ...carried, ...records] : [];
    this.text(724, 142, `信件舱　载重 ${cargoUsed(st)}/${cargoMax(st)}`, { fontSize: '21px', color: COLORS.gold, fontStyle: 'bold' });
    this.text(724, 170, '黄点为船上的信；错过期限、抛弃或拆封都会被岛屿记住。', { fontSize: '12px', color: COLORS.faint });

    const leftX = 724;
    this.panel(leftX, 196, 274, 486, 0x0d2d3d, 0x2c5260);
    const pageSize = 7;
    const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
    this.mailListPage = clamp(this.mailListPage, 0, pageCount - 1);
    list.slice(this.mailListPage * pageSize, (this.mailListPage + 1) * pageSize).forEach((mail, i) => {
      const y = 207 + i * 58;
      const selected = this.selectedMailId === mail.id;
      this.panel(leftX + 8, y, 258, 50, selected ? 0x1b5062 : 0x113748, selected ? 0x76e0d8 : 0x2a5262);
      this.button(leftX + 8, y, 258, 50, '', () => {
        this.selectedMailId = mail.id;
        this.render();
      });
      this.text(leftX + 18, y + 9, this.mailLine(mail), { fontSize: '13px', color: this.mailColor(mail), fontStyle: 'bold', wordWrap: { width: 220 } });
      this.text(leftX + 18, y + 30, `${mail.weight}负重 · ${mail.secrecy} · ${mail.status === 'available' ? '未接载' : this.statusText(mail)}`, {
        fontSize: '10px',
        color: COLORS.faint
      });
    });
    if (list.length === 0) this.text(860, 420, '邮局板上暂时没有信。', { fontSize: '16px', color: COLORS.faint }).setOrigin(0.5);

    // 信件可能超过一屏（每日刷信 + 已送达/退回/抛弃记录）：底部分页。
    if (list.length > pageSize) {
      this.button(leftX + 60, 656, 72, 24, '上一页', () => {
        this.mailListPage = Math.max(0, this.mailListPage - 1);
        this.render();
      }, { small: true, disabled: this.mailListPage === 0 ? '已是第一页' : undefined });
      this.text(leftX + 137, 656, `${this.mailListPage + 1}/${pageCount} · 共 ${list.length} 封`, {
        fontSize: '11px',
        color: COLORS.faint
      }).setOrigin(0.5);
      this.button(leftX + 214, 656, 72, 24, '下一页', () => {
        this.mailListPage = Math.min(pageCount - 1, this.mailListPage + 1);
        this.render();
      }, { small: true, disabled: this.mailListPage >= pageCount - 1 ? '已是最后一页' : undefined });
    }

    const mail = st.mails.find((m) => m.id === this.selectedMailId);
    if (!mail) {
      this.panel(1014, 196, 228, 486, 0x0d2d3d, 0x2c5260);
      this.text(1128, 420, '选择一封信查看详情', { fontSize: '15px', color: COLORS.faint }).setOrigin(0.5);
      return;
    }
    this.drawMailDetail(mail);
  }

  private drawMailDetail(mail: Mail): void {
    const st = this.s();
    const x = 1014;
    this.panel(x, 196, 228, 486, 0x0d2d3d, 0x2c5260);
    this.paragraph(x + 14, 214, 200, mail.title, { fontSize: '17px', color: COLORS.gold, fontStyle: 'bold', lineSpacing: 4 });
    this.text(x + 14, 278, `${islandName(mail.from)} → ${islandName(mail.to)}`, { fontSize: '12px', color: COLORS.teal });
    this.text(x + 14, 299, `寄件：${mail.sender}`, { fontSize: '11px', color: COLORS.faint, wordWrap: { width: 200 } });
    this.text(x + 14, 318, `收件：${mail.recipient}`, { fontSize: '11px', color: COLORS.faint, wordWrap: { width: 200 } });
    const lateColor = st.hour > mail.deadline && mail.status === 'accepted' ? COLORS.red : COLORS.dim;
    this.text(x + 14, 348, `期限 ${clockOf(mail.deadline)}`, { fontSize: '12px', color: lateColor });
    this.text(x + 14, 369, `报酬 ${mail.reward} 银币 · ${mail.weight} 负重`, { fontSize: '12px', color: COLORS.dim });
    this.text(x + 14, 390, secrecyDanger(mail.secrecy), { fontSize: '12px', color: mail.secrecy === '机密' ? COLORS.red : COLORS.dim });
    this.paragraph(x + 14, 414, 200, mail.summary, { fontSize: '12px', color: COLORS.ink, lineSpacing: 4 });

    const buttons: ModalButton[] = [];
    if (mail.status === 'available' && mail.from === st.at) {
      buttons.push({
        label: '接载信件',
        primary: true,
        disabled: cargoUsed(st) + mail.weight > cargoMax(st) ? `载重不足：还需 ${mail.weight}` : undefined,
        onClick: () => {
          mail.status = 'accepted';
          mail.acceptedAt = st.hour;
          log(st, '信件', `接载《${mail.title}》，前往${islandName(mail.to)}。`);
          saveGame(st);
          this.toast(`已接载《${mail.title}》`);
          this.render();
        }
      });
    }
    if (mail.status === 'accepted') {
      buttons.push({ label: '阅读', onClick: () => this.openMailReader(mail) });
      if (mail.to === st.at) {
        buttons.push({
          label: '立即交付',
          primary: true,
          disabled: mail.special === 'will' ? '遗嘱须留到本轮结束' : undefined,
          onClick: () => this.manualDeliver(mail)
        });
      }
      const d = canDiscard(mail);
      buttons.push({ label: '抛弃', danger: true, disabled: d.reason, onClick: () => this.confirmDiscard(mail) });
      if (mail.opened) {
        buttons.push({
          label: '补封',
          disabled: st.sealKits <= 0 ? '没有火漆补封盒' : undefined,
          onClick: () => {
            const r = resealMail(st, mail);
            this.toast(r.ok ? '火漆已经补好。' : r.reason ?? '无法补封。');
            saveGame(st);
            this.render();
          }
        });
      }
    }
    if (mail.status === 'delivered') buttons.push({ label: '已送达', disabled: '完成', onClick: () => undefined });
    if (mail.status === 'returned') buttons.push({ label: '已退回', disabled: '超期', onClick: () => undefined });
    if (mail.status === 'discarded') buttons.push({ label: '已抛弃', disabled: '记录在案', onClick: () => undefined });

    buttons.slice(0, 5).forEach((b, i) => {
      this.button(x + 14, 584 + i * 0 + Math.floor(i / 2) * 34, i % 2 === 0 ? 98 : 98, 28, b.label, b.onClick, {
        small: true,
        primary: b.primary,
        danger: b.danger,
        disabled: b.disabled
      }).setPosition(x + 14 + (i % 2) * 102, 584 + Math.floor(i / 2) * 34);
    });
  }

  private mailLine(mail: Mail): string {
    const prefix = mail.status === 'available' ? '〔板〕' : mail.status === 'accepted' ? '〔船〕' : mail.status === 'delivered' ? '〔达〕' : mail.status === 'discarded' ? '〔弃〕' : '〔退〕';
    return `${prefix}${mail.title}`;
  }

  private mailColor(mail: Mail): string {
    if (mail.status === 'delivered') return COLORS.green;
    if (mail.status === 'discarded' || mail.status === 'returned') return COLORS.red;
    if (mail.secrecy === '机密') return '#ffd1d1';
    return COLORS.ink;
  }

  private statusText(mail: Mail): string {
    if (mail.status === 'accepted') {
      if (mail.opened) return mail.tampered ? '已拆动' : '已阅';
      return `${islandName(mail.to)}待送`;
    }
    return mail.status;
  }

  private drawShipTab(): void {
    const st = this.s();
    this.text(724, 142, '船舱与航海工具', { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' });
    this.panel(724, 176, 244, 206, 0x0d2d3d, 0x2c5260);
    this.text(742, 198, '退潮针号', { fontSize: '18px', color: COLORS.teal, fontStyle: 'bold' });
    const rows = [
      `载重：${cargoUsed(st)}/${cargoMax(st)}（船舱隔板 ${st.upgrades.cargo} 级）`,
      `燃料：${st.fuel.toFixed(1)}/${fuelMax(st)}（煤油柜 ${st.upgrades.tank} 级）`,
      `船壳：${st.hull}/${st.maxHull}（加固 ${st.upgrades.hull} 级）`,
      `引擎：${st.upgrades.engine} 级，机航更快但更耗油`,
      `火漆补封盒：${st.sealKits} 个`,
      `潮汐历：${st.tools.almanac ? '有' : '无'}`,
      `精密时计：${st.tools.chronometer ? '有' : '无'}`,
      `铜望远镜：${st.tools.spyglass ? '有' : '无'}`,
      `防水邮袋：${st.tools.pouch ? '有' : '无'}`
    ];
    this.paragraph(742, 228, 210, rows.join('\n'), { fontSize: '13px', color: COLORS.ink, lineSpacing: 8 });

    this.panel(986, 176, 256, 206, 0x0d2d3d, 0x2c5260);
    this.text(1004, 198, '补给', { fontSize: '18px', color: COLORS.teal, fontStyle: 'bold' });
    const fuelPrice = priceOf(st, st.at, 2);
    this.text(1004, 232, `煤油单价：${fuelPrice} 银币/单位`, { fontSize: '13px', color: COLORS.dim });
    this.button(1004, 258, 105, 32, `买 5 单位`, () => this.buyFuel(5), { small: true });
    this.button(1120, 258, 105, 32, `加满`, () => this.buyFuel(fuelMax(st) - st.fuel), { small: true });
    const repair = repairCost(st);
    this.text(1004, 310, `修船价格：${repair} 银币`, { fontSize: '13px', color: repair === 0 ? COLORS.green : COLORS.dim });
    this.button(1004, 332, 132, 32, repair === 0 ? '船壳完好' : '修补船壳', () => this.repairHull(), {
      small: true,
      primary: true,
      disabled: repair === 0 ? '无需修理' : st.silver < repair ? '银币不足' : undefined
    });

    this.text(724, 405, `${ISLAND_MAP[st.at].name}船坞`, { fontSize: '19px', color: COLORS.gold, fontStyle: 'bold' });
    this.text(724, 428, ISLAND_MAP[st.at].marketNote, { fontSize: '12px', color: COLORS.faint });
    const goods = availableAtIsland(st, st.at);
    goods.forEach((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 724 + col * 262;
      const y = 452 + row * 74;
      const def = item.def;
      const priceIndex = def.id === 'sealkit' ? 0 : item.level;
      const price = priceOf(st, st.at, def.prices[priceIndex] ?? def.prices[def.prices.length - 1]);
      const maxed = item.maxed;
      this.panel(x, y, 246, 62, 0x0f3344, 0x315b68);
      this.text(x + 12, y + 10, def.name + (def.maxLevel > 1 && def.id !== 'sealkit' ? ` Lv.${item.level}` : ''), {
        fontSize: '14px',
        color: COLORS.ink,
        fontStyle: 'bold'
      });
      this.text(x + 12, y + 31, def.description, { fontSize: '9.5px', color: COLORS.faint, wordWrap: { width: 160 } });
      this.button(x + 176, y + 15, 58, 32, maxed ? '已满' : `${price}银`, () => this.buyUpgrade(def.id), {
        small: true,
        primary: true,
        disabled: maxed ? '已达最高等级' : st.silver < price ? '银币不足' : undefined
      });
    });
  }

  private drawLogTab(): void {
    const st = this.s();
    this.text(724, 142, '航行日志', { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' });
    this.text(724, 170, '关系、信件、风暴与抉择会记录在这里；最近事件在最上方。', { fontSize: '12px', color: COLORS.faint });
    this.panel(724, 196, 518, 486, 0x0d2d3d, 0x2c5260);
    st.logs.slice(0, 24).forEach((entry, i) => {
      const y = 214 + i * 19;
      const color = entry.category === '关系' ? COLORS.gold : entry.category === '事件' ? '#ffc6d0' : entry.category === '信件' ? '#bfe9ff' : COLORS.dim;
      this.text(738, y, `[${clockOf(entry.hour)} ${entry.category}] ${entry.text}`, {
        fontSize: '12px',
        color,
        wordWrap: { width: 488 }
      });
    });
  }

  private drawMemoryTab(): void {
    const st = this.s();
    this.text(724, 142, '多周目记忆', { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' });
    this.button(1018, 130, 104, 30, '导出备份', () => this.exportCurrentBackup(), { small: true, primary: true });
    this.button(1130, 130, 104, 30, '恢复备份', () => this.chooseBackupFile(), { small: true });
    this.text(724, 166, '摘要与十轮日志只存在本机：清理浏览器数据或换设备前，请导出 .json 备份随身携带。', { fontSize: '12px', color: COLORS.faint });

    this.panel(724, 172, 518, 116, 0x0d2d3d, 0x2c5260);
    this.text(742, 188, '本局统计', { fontSize: '17px', color: COLORS.teal, fontStyle: 'bold' });
    const stats = [
      `当前周目：${st.cycle}　分数预览：${endingScore(st)}`,
      `已送达：${st.stats.delivered}　延误：${st.stats.late}　私拆：${st.stats.opened}　抛弃：${st.stats.discarded}`,
      `航行里程：${st.stats.distance} 海里　风暴生还：${st.stats.stormsSurvived}　事件：${st.stats.eventsResolved}`,
      `关键秘密：${st.flags.willLied ? '对莫恩说谎' : st.flags.willConfessed ? '承认拆遗嘱' : st.flags.blueGlassSilent ? '蓝玻璃沉默' : '尚未定型'}`
    ].join('\n');
    this.paragraph(742, 214, 480, stats, { fontSize: '13px', color: COLORS.ink, lineSpacing: 8 });

    this.text(724, 302, '旧航海日志存档（点击周目查看具体记录）', { fontSize: '17px', color: COLORS.teal, fontStyle: 'bold' });
    this.panel(724, 326, 518, 76, 0x0d2d3d, 0x2c5260);
    if (st.memories.length === 0) {
      this.text(983, 365, '还没有完成过一轮。本轮结算后，航行/信件/事件日志会保存在这里。', {
        fontSize: '14px',
        color: COLORS.faint,
        align: 'center',
        wordWrap: { width: 430 }
      }).setOrigin(0.5);
      this.panel(724, 414, 518, 268, 0x0d2d3d, 0x2c5260);
      this.text(983, 548, '旧周目的具体航线、送达、私拆、关系与事件会出现在此处。', {
        fontSize: '14px',
        color: COLORS.faint,
        wordWrap: { width: 420 },
        align: 'center'
      }).setOrigin(0.5);
      return;
    }

    if (!st.memories.some((m) => m.id === this.selectedMemoryId)) {
      this.selectedMemoryId = st.memories[0].id;
      this.memoryLogPage = 0;
    }

    st.memories.slice(0, 10).forEach((m, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const selected = this.selectedMemoryId === m.id;
      this.button(724 + col * 103, 336 + row * 36, 96, 30, `第${m.cycle}周目 ${m.score}分`, () => {
        this.selectedMemoryId = m.id;
        this.memoryLogPage = 0;
        this.render();
      }, { small: true, primary: selected });
    });

    const selected = st.memories.find((m) => m.id === this.selectedMemoryId) ?? st.memories[0];
    this.panel(724, 414, 518, 268, 0x0d2d3d, 0x2c5260);
    this.text(740, 428, `${selected.endingTitle} · ${selected.date}`, { fontSize: '14px', color: COLORS.gold, fontStyle: 'bold', wordWrap: { width: 360 } });
    this.text(740, 450, `送达${selected.delivered} / 延误${selected.late} / 私拆${selected.opened} / 抛弃${selected.discarded} / 风暴${selected.stormsSurvived} · ${selected.carriedSecret}`, {
      fontSize: '11px',
      color: COLORS.dim,
      wordWrap: { width: 480 }
    });

    if (!selected.logs.length) {
      this.text(983, 555, '这条旧存档来自日志快照功能更新前，只保留了摘要，没有逐条日志。完成新周目后即可查看。', {
        fontSize: '14px',
        color: COLORS.faint,
        align: 'center',
        wordWrap: { width: 430 }
      }).setOrigin(0.5);
      return;
    }

    const pageSize = 9;
    const pageCount = Math.ceil(selected.logs.length / pageSize);
    this.memoryLogPage = clamp(this.memoryLogPage, 0, pageCount - 1);
    selected.logs.slice(this.memoryLogPage * pageSize, (this.memoryLogPage + 1) * pageSize).forEach((entry, i) => {
      const color = entry.category === '关系' ? COLORS.gold : entry.category === '事件' ? '#ffc6d0' : entry.category === '信件' ? '#bfe9ff' : COLORS.dim;
      this.text(740, 474 + i * 21, `[${clockOf(entry.hour)} ${entry.category}] ${entry.text}`, {
        fontSize: '11.5px',
        color,
        wordWrap: { width: 482 }
      });
    });

    this.button(740, 652, 70, 22, '上一页', () => {
      this.memoryLogPage = Math.max(0, this.memoryLogPage - 1);
      this.render();
    }, { small: true, disabled: this.memoryLogPage === 0 ? '已是第一页' : undefined });
    this.text(983, 655, `${this.memoryLogPage + 1}/${pageCount} · 共 ${selected.logs.length} 条`, {
      fontSize: '12px',
      color: COLORS.faint
    }).setOrigin(0.5);
    this.button(1160, 652, 70, 22, '下一页', () => {
      this.memoryLogPage = Math.min(pageCount - 1, this.memoryLogPage + 1);
      this.render();
    }, { small: true, disabled: this.memoryLogPage >= pageCount - 1 ? '已是最后一页' : undefined });
  }

  private drawHelpTab(): void {
    const st = this.s();
    this.text(724, 142, '邮政手册', { fontSize: '22px', color: COLORS.gold, fontStyle: 'bold' });
    const body = [
      '目标：六天内尽可能递送信件。无法一次送完，必须规划路线、潮窗与载重。',
      '',
      '潮汐：每 12 小时一次高潮。浅滩航线潮位低于 0.35 时扬帆无法通过；机帆可低速硬推。',
      '时间：等待和航行使时间流逝。期限到点仍在船上的信会退回，并伤害收发双方关系。',
      '关系：高关系提供折扣与分支，低关系会触发盘问、敌意价格或不同事件。',
      '私拆：公开信影响小，私密/机密信可能被发现；火漆补封盒可掩盖普通裂痕。',
      '工具：潮汐历显示精确潮位；精密时计显示精确 ETA；望远镜揭示暗礁航线。',
      '燃料：扬帆不耗燃料但慢；机帆耗燃料，可逆风与低潮赶路。',
      '存档：每次港口操作自动保存；航行中不落盘，强制关闭会回到上一次港口。',
      '备份：“记忆”页或标题界面可导出带封签的 .json，换设备/清理数据后读文件即可整体找回。',
      '手工改动备份（如负数重量、改银币）会使封签失效并被拒绝；恢复只认游戏导出的文件。',
      '多周目：完成本轮后，结局分数、秘密和最多 100 条具体日志保留；下轮在“记忆”页选择旧周目查看。'
    ].join('\n');
    this.panel(724, 178, 518, 504, 0x0d2d3d, 0x2c5260);
    this.paragraph(744, 202, 478, body, { fontSize: '15px', color: COLORS.ink, lineSpacing: 9 });
    this.text(744, 650, `当前建议：${st.hour < 8 ? '先等潮，不要在低潮硬闯盐泽礁。' : '查看信件目的地，选一条顺路航线。'}`, {
      fontSize: '13px',
      color: COLORS.gold
    });
  }

  private button(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    opts: { primary?: boolean; danger?: boolean; disabled?: string; small?: boolean } = {}
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.graphics();
    const disabled = Boolean(opts.disabled);
    const base = opts.danger ? 0x6f2e35 : opts.primary ? 0x1b6f78 : 0x173d4f;
    const line = opts.danger ? 0xff8b7a : opts.primary ? 0x89f0e8 : 0x527d8c;
    bg.fillStyle(base, disabled ? 0.35 : 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(1, line, disabled ? 0.25 : 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    c.add(bg);
    const t = this.text(0, -1, label, {
      fontSize: opts.small ? '13px' : '16px',
      color: disabled ? '#6f8588' : COLORS.ink,
      fontStyle: opts.primary ? 'bold' : 'normal',
      align: 'center',
      wordWrap: { width: w - 14 }
    }).setOrigin(0.5);
    c.add(t);
    if (!disabled) {
      const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => bg.clear().fillStyle(base, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 8).lineStyle(2, line, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 8));
      zone.on('pointerout', () => bg.clear().fillStyle(base, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 8).lineStyle(1, line, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, 8));
      zone.on('pointerdown', onClick);
      c.add(zone);
    }
    this.layer.add(c);
    return c;
  }

  private text(x: number, y: number, content: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, content, {
      fontFamily: '"Noto Serif SC","Songti SC","Microsoft YaHei",serif',
      color: COLORS.ink,
      ...style
    });
    this.layer.add(t);
    return t;
  }

  private overlayText(x: number, y: number, content: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, content, {
      fontFamily: '"Noto Serif SC","Songti SC","Microsoft YaHei",serif',
      color: COLORS.ink,
      ...style
    });
    this.overlayLayer.add(t);
    return t;
  }

  private paragraph(x: number, y: number, width: number, content: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    return this.text(x, y, content, { wordWrap: { width }, ...style });
  }

  private panel(x: number, y: number, w: number, h: number, fill = COLORS.panel, line = COLORS.line, alpha = 1): void {
    const g = this.add.graphics();
    g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(1, line, 0.9).strokeRoundedRect(x, y, w, h, 12);
    this.layer.add(g);
  }

  private overlayPanel(x: number, y: number, w: number, h: number, fill = 0x102f40, line = 0x6dbac0): void {
    const g = this.add.graphics();
    g.fillStyle(fill, 0.98).fillRoundedRect(x, y, w, h, 16);
    g.lineStyle(2, line, 1).strokeRoundedRect(x, y, w, h, 16);
    this.overlayLayer.add(g);
  }

  private overlayButton(x: number, y: number, w: number, h: number, label: string, onClick: () => void, opts: { primary?: boolean; danger?: boolean; disabled?: string } = {}): void {
    const c = this.add.container(x, y);
    const bg = this.add.graphics();
    const disabled = Boolean(opts.disabled);
    const base = opts.danger ? 0x6f2e35 : opts.primary ? 0x1b6f78 : 0x173d4f;
    const line = opts.danger ? 0xff8b7a : opts.primary ? 0x89f0e8 : 0x527d8c;
    bg.fillStyle(base, disabled ? 0.35 : 0.96).fillRoundedRect(-w / 2, -h / 2, w, h, 9);
    bg.lineStyle(1, line, disabled ? 0.25 : 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 9);
    c.add(bg);
    const t = this.add.text(0, -1, opts.disabled ?? label, {
      fontFamily: '"Noto Serif SC","Songti SC","Microsoft YaHei",serif',
      fontSize: '16px',
      color: disabled ? '#789094' : COLORS.ink,
      align: 'center',
      wordWrap: { width: w - 16 }
    }).setOrigin(0.5);
    c.add(t);
    if (!disabled) {
      const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', onClick);
      c.add(zone);
    }
    this.overlayLayer.add(c);
  }

  private openModal(options: {
    title: string;
    body: string;
    buttons?: ModalButton[];
    width?: number;
    height?: number;
    closable?: boolean;
  }): void {
    this.closeOverlay();
    this.modalOpen = true;
    const width = options.width ?? 760;
    const height = options.height ?? 460;
    const x = (1280 - width) / 2;
    const y = (720 - height) / 2;
    const dim = this.add.graphics();
    dim.fillStyle(0x020b12, 0.72).fillRect(0, 0, 1280, 720);
    this.overlayLayer.add(dim);
    this.overlayPanel(x, y, width, height, 0x102f40, 0x76d3d0);
    this.overlayText(x + 28, y + 24, options.title, { fontSize: '26px', color: COLORS.gold, fontStyle: 'bold', wordWrap: { width: width - 70 } });
    this.overlayText(x + 28, y + 76, options.body, {
      fontSize: '15px',
      color: COLORS.ink,
      lineSpacing: 7,
      wordWrap: { width: width - 56 }
    });
    if (options.closable !== false) {
      this.overlayButton(x + width - 42, y + 25, 30, 30, '×', () => this.closeOverlay(), {});
    }
    const buttons = options.buttons ?? [];
    const bw = Math.min(220, Math.floor((width - 56) / Math.max(1, buttons.length)) - 8);
    buttons.forEach((b, i) => {
      const bx = x + 32 + i * (bw + 12) + bw / 2;
      this.overlayButton(bx, y + height - 50, bw, 38, b.label, b.onClick, b);
    });
  }

  private closeOverlay(): void {
    this.modalOpen = false;
    this.clearLayer(this.overlayLayer);
  }

  private toast(text: string): void {
    this.notices.push(text);
    if (this.notices.length > 3) this.notices.shift();
    this.drawNotice();
    this.time.delayedCall(3600, () => {
      this.notices.shift();
      this.drawNotice();
    });
  }

  private drawNotice(): void {
    if (!this.state) return;
    // Notices are redrawn as part of render; draw on overlay to survive modals minimally.
    const existing = this.children.getByName('notice-layer');
    existing?.destroy();
    const c = this.add.container(34, 620).setName('notice-layer');
    this.layer.add(c);
    this.notices.slice(-3).forEach((n, i) => {
      const g = this.add.graphics();
      g.fillStyle(0x071c29, 0.86).fillRoundedRect(0, i * 30, 620, 26, 7);
      g.lineStyle(1, 0x4c8794, 0.8).strokeRoundedRect(0, i * 30, 620, 26, 7);
      c.add(g);
      c.add(this.add.text(12, i * 30 + 4, n, { fontFamily: '"Noto Serif SC","Microsoft YaHei",serif', fontSize: '13px', color: COLORS.ink, wordWrap: { width: 596 } }));
    });
  }

  private openMailReader(mail: Mail): void {
    const st = this.s();
    const wasOpened = mail.opened;
    if (!wasOpened) openMail(st, mail);
    saveGame(st);
    this.render();
    this.openModal({
      width: 760,
      height: 500,
      title: mail.title,
      body: `寄件：${mail.sender}\n收件：${mail.recipient}\n密级：${mail.secrecy} · ${secrecyDanger(mail.secrecy)}\n\n${mail.body}\n\n${mail.opened && mail.tampered ? '火漆或折痕已经留下：交付时可能被发现。' : mail.opened ? '已用新火漆补封：外部痕迹被掩盖，但你读过内容这件事仍会影响特殊交付奖励。' : '封口仍然完整。'}`,
      buttons: [
        {
          label: st.sealKits > 0 && mail.opened ? `用补封盒（剩余${st.sealKits}）` : '没有补封盒',
          disabled: st.sealKits > 0 && mail.opened ? undefined : '没有可用补封盒',
          onClick: () => {
            resealMail(st, mail);
            saveGame(st);
            this.closeOverlay();
            this.render();
          }
        },
        { label: '合上信', primary: true, onClick: () => this.closeOverlay() }
      ]
    });
  }

  private manualDeliver(mail: Mail): void {
    const st = this.s();
    const result = deliverAtIsland(st, st.at);
    saveGame(st);
    result.notes.forEach((n) => this.toast(n));
    if (result.delivered === 0) this.toast('这里没有可交付的目的地信件。');
    this.selectedMailId = mail.id;
    this.render();
  }

  private confirmDiscard(mail: Mail): void {
    this.openModal({
      width: 620,
      height: 300,
      title: `抛弃《${mail.title}》？`,
      body: '邮政规程会记住这次选择。收、寄岛屿关系都会下降；后续事件可能提及失踪的信件。',
      buttons: [
        { label: '取消', onClick: () => this.closeOverlay() },
        {
          label: '确认抛弃',
          danger: true,
          onClick: () => {
            discardMail(this.s(), mail);
            saveGame(this.s());
            this.closeOverlay();
            this.render();
          }
        }
      ]
    });
  }

  private passTime(hours: number): void {
    const st = this.s();
    if (st.ended || st.travel.active) return;
    for (let i = 0; i < hours; i += 1) {
      st.hour += 1;
      this.handleHourCross();
      if (st.hour >= MAX_HOUR) {
        this.finishRun();
        return;
      }
    }
    log(st, '航行', `在${islandName(st.at)}等待 ${hours} 小时，潮位变为 ${tideAt(st.hour).toFixed(2)}。`);
    saveGame(st);
    this.render();
  }

  private waitForTide(): void {
    const st = this.s();
    let d = 0;
    while (d < 12 && !shallowOpen(st.hour + d)) d += 0.5;
    const hours = Math.max(1, Math.ceil(d));
    this.passTime(hours);
    this.toast(`你等到潮位 ${tideAt(st.hour).toFixed(2)}。`);
  }

  private handleHourCross(): string[] {
    const st = this.s();
    spawnDailyMail(st);
    const notices: string[] = [];
    const expired = acceptedMails(st).filter((m) => st.hour > m.deadline && !m.deliveredAt && m.special !== 'will');
    for (const mail of expired) {
      mail.status = 'returned';
      st.stats.late += 1;
      changeRelation(st, mail.from, -4, '信件超期');
      changeRelation(st, mail.to, -3, '等待落空');
      notices.push(`《${mail.title}》超过期限，被退回邮袋板。`);
      log(st, '信件', `《${mail.title}》超期：${islandName(mail.from)} → ${islandName(mail.to)}。`);
    }
    notices.forEach((n) => this.toast(n));
    return notices;
  }

  private buyFuel(amount: number): void {
    const st = this.s();
    const can = Math.max(0, Math.min(amount, fuelMax(st) - st.fuel));
    if (can <= 0) {
      this.toast('煤油柜已满。');
      return;
    }
    const unit = priceOf(st, st.at, 2);
    const cost = Math.ceil(can * unit);
    if (st.silver < cost) {
      this.toast('银币不足。');
      return;
    }
    st.silver -= cost;
    st.fuel += can;
    log(st, '船舶', `在${islandName(st.at)}购买 ${can.toFixed(1)} 单位煤油，花费 ${cost} 银币。`);
    saveGame(st);
    this.render();
  }

  private repairHull(): void {
    const st = this.s();
    const cost = repairCost(st);
    if (cost <= 0 || st.silver < cost) return;
    st.silver -= cost;
    st.hull = st.maxHull;
    log(st, '船舶', `船壳已修补到 ${st.maxHull}，花费 ${cost} 银币。`);
    saveGame(st);
    this.render();
  }

  private buyUpgrade(id: string): void {
    const st = this.s();
    const goods = availableAtIsland(st, st.at).find((g) => g.def.id === id);
    if (!goods) return;
    const def = goods.def;
    const level = goods.level;
    if (goods.maxed) return;
    const price = priceOf(st, st.at, def.prices[level] ?? def.prices[def.prices.length - 1]);
    if (st.silver < price) {
      this.toast('银币不足。');
      return;
    }
    st.silver -= price;
    if (def.kind === 'tool') st.tools[id] = true;
    if (def.kind === 'consumable') st.sealKits += 1;
    if (def.kind === 'cargo') st.upgrades.cargo += 1;
    if (def.kind === 'tank') st.upgrades.tank += 1;
    if (def.kind === 'engine') st.upgrades.engine += 1;
    if (def.kind === 'hull') {
      st.upgrades.hull += 1;
      st.maxHull += 1;
      st.hull += 1;
    }
    log(st, '船舶', `安装/购入「${def.name}」，花费 ${price} 银币。`);
    saveGame(st);
    this.render();
  }

  private startVoyage(route: Route, mode: TravelMode): void {
    const st = this.s();
    if (st.travel.active || st.ended) return;
    const est = estimateVoyage(st, route, st.at, mode);
    if (est.blocked) {
      this.toast(est.blocked);
      return;
    }
    const from = st.at;
    const to = otherEnd(route, from);

    // First departure always gives the tide lesson before the boat leaves.
    const forced = getForcedRouteEvent(st, { from, to, routeId: route.id });
    if (forced) {
      this.beginTravel(route, mode, est.fuel);
      st.travel.paused = true;
      this.openGameEvent(forced, { from, to, routeId: route.id, mode });
      return;
    }

    this.beginTravel(route, mode, est.fuel);
    log(st, '航行', `从${islandName(from)}出发，${mode === 'sail' ? '扬帆' : '机帆'}前往${islandName(to)}。预计${est.hours}小时。`);
    this.render();
  }

  /** 初始化一段新航程；resolvedEvents 清空，保证每个航段的随机事件只发生一次。 */
  private beginTravel(route: Route, mode: TravelMode, fuelPlanned: number): void {
    const st = this.s();
    // 离港：任何尚未触发的到港事件弹窗都作废，避免航行中旧事件突然弹出。
    this.clearPendingPortEventTimer();
    const from = st.at;
    const to = otherEnd(route, from);
    st.travel.active = true;
    st.travel.routeId = route.id;
    st.travel.from = from;
    st.travel.to = to;
    st.travel.mode = mode;
    st.travel.progress = 0;
    st.travel.total = route.distance;
    st.travel.fuelPlanned = fuelPlanned;
    st.travel.weather = 'clear';
    st.travel.paused = false;
    st.travel.resolvedEvents = [];
  }

  private tickTravel(): void {
    if (!this.state || this.modalOpen) return;
    const st = this.state;
    if (!st.travel.active || st.travel.paused || st.ended) return;

    const dt = VOYAGE_STEP_HOURS;
    const route = ROUTES.find((r) => r.id === st.travel.routeId);
    if (!route) {
      st.travel.active = false;
      return;
    }
    const before = Math.floor(st.hour);
    // 必须与 estimateVoyage 相同：先按当前小时算航进，再推进时间，
    // 并共用 voyageMoveAt 的浅滩/洋流/天气模型，预估 ETA 与燃料才不会和实际漂移。
    const move = voyageMoveAt(st, st.hour, route, st.travel.from, st.travel.mode, st.travel.weather);
    st.hour += dt;

    st.travel.progress += move.progress;
    if (move.fuel > 0) {
      st.fuel = Math.max(0, st.fuel - move.fuel);
      st.stats.fuelUsed += move.fuel;
      if (st.fuel <= 0.01 && st.travel.mode === 'motor') {
        st.travel.mode = 'sail';
        st.travel.fuelPlanned = 0;
        this.toast('燃料耗尽，邮船自动转为扬帆随潮。');
      }
    }

    const after = Math.floor(st.hour);
    if (after > before) {
      this.handleHourCross();
      if (st.hour >= MAX_HOUR) {
        this.finishRun();
        return;
      }
      this.maybeRouteEvent(route);
      if (this.modalOpen) return;
    }

    if (st.travel.progress >= route.distance) this.arrive(route);
    else this.render();
  }

  private maybeRouteEvent(route: Route): void {
    const st = this.s();
    const ctx = { from: st.travel.from, to: st.travel.to, routeId: route.id };
    // 教程类强制事件只在离港时处理；航段内一律走加权随机池，
    // 且排除本航段已经结算过的事件（白雾、被忽略的漂流少年等不会反复弹出）。
    const event = pickRouteEvent(st, ctx, this.rng, new Set(st.travel.resolvedEvents ?? []));
    if (event) {
      st.travel.paused = true;
      if (event.id === 'sudden-storm') st.travel.weather = 'storm';
      if (event.id === 'white-fog') st.travel.weather = 'fog';
      this.openGameEvent(event, { ...ctx, mode: st.travel.mode });
    }
  }

  private openGameEvent(event: GameEvent, ctx: { from?: IslandId; to?: IslandId; routeId?: string; island?: IslandId; mode?: TravelMode }): void {
    const st = this.s();
    // 港口事件做一次新鲜度复检：传入的事件对象可能来自延时回调/闭包，
    // 若它已经不满足触发条件（玩家在同一时刻提前结算过），直接丢弃，绝不重复结算。
    if (event.trigger === 'port') {
      const island = ctx.island ?? st.at;
      const fresh = getPortEvent(st, island);
      if (!fresh || fresh.id !== event.id || island !== st.at || st.travel.active || st.ended) return;
    }
    st.stats.eventsResolved += 0; // incremented on choice to avoid counting canceled port events
    const choices = eventChoicesFor(event, st).map((choice) => ({
      label: choice.disabled ? `${choice.label}（${choice.disabled}）` : choice.label,
      disabled: choice.disabled,
      primary: false,
      onClick: () => {
        const outcome = choice.run();
        this.applyOutcome(outcome.effects);
        st.stats.eventsResolved += 1;
        if (st.travel.active && !event.once) {
          st.travel.resolvedEvents = st.travel.resolvedEvents ?? [];
          if (!st.travel.resolvedEvents.includes(event.id)) st.travel.resolvedEvents.push(event.id);
        }
        log(st, '事件', `${event.title}：${outcome.text.slice(0, 42)}${outcome.text.length > 42 ? '……' : ''}`);
        this.closeOverlay();
        if (st.travel.active) {
          st.travel.paused = false;
          st.travel.weather = 'clear';
        }
        saveGame(st);
        this.toast(outcome.text);
        this.render();
        if (st.hour >= MAX_HOUR) this.finishRun();
      }
    }));

    let body = event.context;
    choices.forEach((c, i) => {
      const original = eventChoicesFor(event, st)[i];
      if (original.detail) body += `\n\n【${original.label}】${original.detail}`;
    });

    this.openModal({
      width: 820,
      height: 560,
      title: event.title,
      body,
      closable: false,
      buttons: choices.slice(0, 4)
    });
  }

  private applyOutcome(effects: EventOutcome['effects']): void {
    if (!effects) return;
    const st = this.s();
    st.silver = Math.max(0, st.silver + (effects.silver ?? 0));
    st.fuel = clamp(st.fuel + (effects.fuel ?? 0), 0, fuelMax(st));
    st.hull = clamp(st.hull + (effects.hull ?? 0), 0, st.maxHull);
    st.sealKits += effects.sealKits ?? 0;
    Object.entries(effects.relations ?? {}).forEach(([id, value]) => changeRelation(st, id as IslandId, value ?? 0, '事件后果'));
    Object.entries(effects.flags ?? {}).forEach(([k, v]) => {
      st.flags[k] = v as boolean | number | string;
    });
    if (effects.tool) st.tools[effects.tool] = true;
    if (effects.delayHours) {
      for (let i = 0; i < effects.delayHours; i += 1) {
        st.hour += 1;
        this.handleHourCross();
      }
      if (st.travel.active) log(st, '事件', `事件使航程额外等待 ${effects.delayHours} 小时。`);
    }
  }

  private arrive(route: Route): void {
    const st = this.s();
    st.hour = Math.ceil(st.hour * 2) / 2;
    st.at = st.travel.to;
    st.travel.active = false;
    st.travel.paused = false;
    st.travel.progress = route.distance;
    st.travel.weather = 'clear';
    st.stats.distance += route.distance;
    log(st, '航行', `抵达${islandName(st.at)}，时间为 ${clockOf(st.hour)}。`);

    const result = deliverAtIsland(st, st.at);
    result.notes.forEach((n) => this.toast(n));

    this.selectedRouteId = null;
    this.tab = 'port';
    saveGame(st);
    this.render();

    const portEvent = getPortEvent(st, st.at);
    this.clearPendingPortEventTimer();
    if (portEvent) {
      this.pendingPortEventTimer = this.time.delayedCall(450, () => {
        this.pendingPortEventTimer = null;
        // 回调触发时重新校验，而不是直接用闭包里的旧事件对象：
        // 玩家可能在 450ms 内已点“前往处理”结算（奖励已发、condition 变 false），
        // 也可能离港或已在别的弹窗里——这些情况都绝不能再弹一次旧事件。
        const cur = this.state;
        if (!cur || cur.ended || cur.travel.active || this.modalOpen || cur.at !== st.at) return;
        const still = getPortEvent(cur, cur.at);
        if (!still || still.id !== portEvent.id) return;
        this.openGameEvent(still, { island: cur.at });
      });
    }
  }

  /** 取消尚未触发的港口事件自动弹窗（玩家手动处理或离港时调用）。 */
  private clearPendingPortEventTimer(): void {
    if (this.pendingPortEventTimer) {
      this.pendingPortEventTimer.remove(false);
      this.pendingPortEventTimer = null;
    }
  }

  private finishRun(): void {
    const st = this.s();
    if (st.ended) return;
    st.hour = MAX_HOUR;
    st.ended = true;
    st.travel.active = false;
    st.travel.paused = false;
    st.travel.weather = 'clear';

    const will = st.mails.find((m) => m.special === 'will');
    if (will) {
      if (will.status === 'accepted' && !will.tampered) {
        changeRelation(st, 'tidehome', 10, '守住了莫恩的封缄信');
        st.flags.willKept = true;
      } else if (will?.opened) {
        changeRelation(st, 'tidehome', -8, '遗嘱的秘密被带出信外');
      } else {
        changeRelation(st, 'tidehome', -2, '遗嘱没有随船保管到最后');
      }
    }
    for (const mail of acceptedMails(st).filter((m) => m.special !== 'will')) {
      mail.status = 'returned';
      st.stats.late += 1;
      changeRelation(st, mail.from, -3, '本轮结束仍未送达');
    }

    const score = endingScore(st);
    const title = endingTitle(score);
    const secret = st.flags.willKept ? 'will-kept' : st.flags.willLied ? 'will-lie' : st.flags.willConfessed ? 'will-read' : st.flags.blueGlassSilent ? 'blue-glass' : 'ordinary-tide';
    const memory: RunMemory = {
      id: st.runId,
      cycle: st.cycle,
      date: new Date().toISOString().slice(0, 10),
      endingTitle: title,
      score,
      delivered: st.stats.delivered,
      late: st.stats.late,
      opened: st.stats.opened,
      discarded: st.stats.discarded,
      bestRelations: Object.entries(st.relations).sort((a, b) => b[1] - a[1]).slice(0, 3) as [string, number][],
      carriedSecret: secret,
      finalRelations: { ...st.relations },
      stormsSurvived: st.stats.stormsSurvived,
      logs: st.logs.slice(0, 100)
    };
    st.memories.unshift(memory);
    st.memories = st.memories.slice(0, 10);
    saveGame(st);
    this.render();
    this.showEnding(memory);
  }

  private reopenEnding(): void {
    const memory = this.s().memories[0];
    if (memory) this.showEnding(memory);
  }

  private showEnding(memory: RunMemory): void {
    const st = this.s();
    const body = [
      `第六日的最后一次夜潮退去，退潮针号回到群岛邮路的记忆里。`,
      '',
      `结局：${memory.endingTitle}`,
      `分数：${memory.score}`,
      `送达 ${memory.delivered} 封 · 延误 ${memory.late} 封 · 私拆 ${memory.opened} 封 · 抛弃 ${memory.discarded} 封`,
      `风暴生还 ${memory.stormsSurvived} 次`,
      '',
      `关系最高：${memory.bestRelations.map(([id, v]) => `${islandName(id as IslandId)} ${v}`).join('、') || '无'}`,
      `带入下轮的秘密标记：${memory.carriedSecret}`,
      '',
      '本轮 100 条具体航行/信件/关系/事件日志已归档；下一周目可在右侧“记忆”页选择本周目分页查看。',
      '多周目不会清空旧日志：你可以继承少量银币，再次尝试另一条潮路、另一套道德选择。',
      '想换设备或担心清理浏览器数据？去“记忆”页点“导出备份”，把所有周目存成一个 .json 文件带走。'
    ].join('\n');

    this.openModal({
      width: 840,
      height: 560,
      title: '本轮潮邮结算',
      body,
      closable: false,
      buttons: [
        {
          label: '开始下一周目',
          primary: true,
          onClick: () => this.startNewGame(st.cycle + 1, st.memories)
        },
        {
          label: '返回标题',
          onClick: () => this.renderTitle()
        },
        {
          label: '留在港口查看',
          onClick: () => this.closeOverlay()
        }
      ]
    });
  }
}

function st_safe(state: GameState | null): GameState | null {
  return state;
}
