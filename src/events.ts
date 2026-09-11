import { ISLAND_MAP } from './data';
import { clamp, log } from './engine';
import type { EventContext, GameEvent, GameState, Mail } from './types';

export const EVENTS: GameEvent[] = [
  {
    id: 'first-tide-guide',
    title: '老局长的潮汐课',
    context: '解缆前，莫恩把一只湿漉漉的铜环套在罗盘边。“邮船不是被人开走的，是被潮水借走的。看好潮高，浅滩只会给你几个小时。”',
    trigger: 'route',
    once: true,
    condition: (s, ctx) => !s.flags.guideSeen && ctx?.from === 'tidehome',
    choices: () => [
      {
        label: '认真记下涨潮窗口',
        detail: '获得潮汐历，未来航线会显示精确潮高。',
        outcome: (s) => {
          s.tools.almanac = true;
          s.flags.guideSeen = true;
          log(s, '事件', '老局长把潮汐历钉在船舱内侧。');
          return { text: '你学会了看潮高：浅滩通常在潮位超过 0.35 后开放。潮汐历已安装。' };
        }
      },
      {
        label: '先出海，凭感觉试试',
        detail: '不获得工具，但保留一段老水手式的自信。',
        outcome: (s) => {
          s.flags.guideSeen = true;
          log(s, '事件', '你决定凭船感判断潮水。');
          return { text: '莫恩叹了口气：“感觉也会湿，尤其在膝盖以下。”你仍可以后在潮汐港购买潮汐历。' };
        }
      }
    ]
  },
  {
    id: 'sudden-storm',
    title: '黑云压过潮线',
    context: '海面忽然变成铅色，浪头像一叠叠湿透的黑信。船帆发出绷紧的声响，远处浅滩正在消失。',
    trigger: 'route',
    weight: 6,
    condition: (s, ctx) => !s.flags.stormResolved && s.hour < 80 && ['tide-salt', 'salt-crab', 'crab-lantern'].includes(ctx?.routeId ?? ''),
    choices: (s) => [
      {
        label: '收帆，绕进背风潮沟',
        detail: '等待约 3 小时，几乎不损伤船壳。',
        outcome: (s) => {
          s.flags.stormResolved = true;
          s.stats.stormsSurvived += 1;
          log(s, '事件', '你让风暴先过去，邮袋没有进水。');
          return { text: '你把船交给一条缓慢的回流。风暴砸在海面，像无数只拳头敲错了鼓点。', effects: { delayHours: 3, flags: { stormWaited: true } } };
        }
      },
      {
        label: '闯过风眼',
        detail: '节省时间，但船壳受损；没有防水邮袋时会弄湿一封信。',
        condition: () => ({ ok: s.hull > 3, reason: '船壳太低，强行闯风暴可能沉船。' }),
        outcome: (s) => {
          const damage = Math.max(1, 4 - s.upgrades.hull);
          s.hull = clamp(s.hull - damage, 1, s.maxHull);
          s.flags.stormResolved = true;
          s.stats.stormsSurvived += 1;
          let text = `风暴撕过船舷，船壳 -${damage}。`;
          if (!s.tools.pouch) {
            const victim = s.mails.filter((m) => m.status === 'accepted' && !m.opened)[0];
            if (victim) {
              victim.tampered = true;
              text += ` 《${victim.title}》被海水泡软，封蜡留下了可疑痕迹。`;
            }
          } else {
            text += ' 防水邮袋把所有信挡得严严实实。';
          }
          log(s, '事件', '你强行穿过风暴。');
          return { text, effects: { flags: { stormRushed: true } } };
        }
      },
      {
        label: '解开一封重信压舱',
        detail: '抛弃普通信件以稳住船；机密信不能这样处理。',
        condition: (s) => ({
          ok: s.mails.some((m) => m.status === 'accepted' && m.secrecy !== '机密' && m.special !== 'will'),
          reason: '没有可舍弃的普通信件。'
        }),
        outcome: (s) => {
          const victim = s.mails.find((m) => m.status === 'accepted' && m.secrecy !== '机密' && m.special !== 'will');
          let text = '你稳住了船。';
          if (victim) {
            victim.status = 'discarded';
            victim.tampered = true;
            s.stats.discarded += 1;
            text = `你把《${victim.title}》压进浪里，船首终于低下。收信人不会收到它。`;
          }
          s.flags.stormResolved = true;
          s.stats.stormsSurvived += 1;
          return { text, effects: { flags: { stormSacrificedMail: true } } };
        }
      }
    ]
  },
  {
    id: 'castaway',
    title: '浮标上的鼓手',
    context: '你听见敲浮标的声音：一名蟹锣岛少年抱着铃铛漂在潮带上，红蟹壳头盔在浪里一沉一浮。',
    trigger: 'route',
    weight: 4,
    condition: (s, ctx) => !s.flags.castawayRescued && ['salt-crab', 'crab-lantern', 'lantern-gull'].includes(ctx?.routeId ?? ''),
    choices: (s) => [
      {
        label: '调转船首救人',
        detail: '多花约 2 小时；蟹锣岛会记住。',
        outcome: (s) => {
          s.flags.castawayRescued = true;
          log(s, '事件', '你救起了一名蟹锣岛少年。');
          return {
            text: s.tools.spyglass ? '望远镜让你早早避开碎木，救援非常顺利。少年答应在蟹锣岛报答你。' : '少年爬上船时带上来半船水，但他把铃铛抱得很牢。',
            effects: { delayHours: 2, flags: { castawayRescued: true } }
          };
        }
      },
      {
        label: '赶潮，假装没听见',
        detail: '节省时间，但会伤害蟹锣岛关系。',
        outcome: (s) => {
          s.flags.castawayIgnored = true;
          log(s, '事件', '你离开了浮标上的求救声。');
          return { text: '铃铛声被引擎或风声甩在身后。很多年以后，你可能还会记得那个节奏。', effects: { relations: { crab: -5 } } };
        }
      }
    ]
  },
  {
    id: 'floating-crate',
    title: '漂过的煤油箱',
    context: '一只钉着税关铜牌的木箱漂过航线，箱角还在缓慢冒泡。',
    trigger: 'route',
    weight: 3,
    condition: (_, ctx) => ['tide-brine', 'lantern-brine', 'crab-lantern'].includes(ctx?.routeId ?? ''),
    choices: (s) => [
      {
        label: '用钩杆拖上船',
        detail: '获得燃料；没有望远镜时可能撞伤船壳。',
        outcome: (s) => {
          const safe = s.tools.spyglass;
          const fuel = 5;
          let text = `木箱里有剩油，燃料 +${fuel}。`;
          if (!safe) {
            s.hull = clamp(s.hull - 1, 1, s.maxHull);
            text += ' 箱子里藏着断钉，船壳 -1。';
          } else {
            text += ' 望远镜让你先看见断钉，毫发无伤。';
          }
          return { text, effects: { fuel } };
        }
      },
      {
        label: '离它远一点',
        detail: '什么也不发生。',
        outcome: () => ({ text: '你绕开木箱。潮水会替别人决定它的去向。' })
      }
    ]
  },
  {
    id: 'white-fog',
    title: '白雾吞掉灯塔',
    context: '雾不是飘来的，而像有人在海面上摊开一整张湿信纸。航标、船头和自己的名字都变得不可靠。',
    trigger: 'route',
    weight: 4,
    condition: (_, ctx) => ['lantern-brine', 'lantern-gull', 'tide-lantern'].includes(ctx?.routeId ?? ''),
    choices: (s) => [
      {
        label: '听潮下锚，等雾散',
        detail: '延误约 2 小时。',
        outcome: () => ({ text: '你数着远处浮标的闷响。雾散后，海图仍然相信你。', effects: { delayHours: 2 } })
      },
      {
        label: '用望远镜盯住最高树梢',
        detail: '需要铜望远镜。',
        condition: (s) => ({ ok: Boolean(s.tools.spyglass), reason: '雾里没有可确认的方位线。' }),
        outcome: () => ({ text: '你在雾里抓住灯枝岛最高的一条树影，像用针穿过湿信纸。没有延误。', effects: { silver: 3 } })
      },
      {
        label: '相信精密时计继续航行',
        detail: '需要精密时计。',
        condition: (s) => ({ ok: Boolean(s.tools.chronometer), reason: '没有精确时间，航位推算会漂。' }),
        outcome: () => ({ text: '秒针每响一下，你就在海图上前进一小格。雾散时，船头离浮标只差半链。' })
      }
    ]
  },
  {
    id: 'loose-seal',
    title: '松动的火漆',
    context: '船舱里一封信的火漆正在热气中翘起。没有人看见，但封口已经松动到可以不留大痕迹地揭开。',
    trigger: 'route',
    weight: 3,
    condition: (s) => s.mails.some((m) => m.status === 'accepted' && !m.opened && (m.secrecy === '私密' || m.secrecy === '机密')),
    choices: (_s, mail) => [
      {
        label: '只看一眼',
        detail: '打开当前选中的私密/机密信，可能获得情报，也会留下痕迹。',
        outcome: (s, mail) => {
          if (!mail) return { text: '那封信滑到了舱底，你没有再碰它。' };
          mail.opened = true;
          mail.tampered = true;
          s.stats.opened += 1;
          log(s, '信件', `你在航行中偷看了《${mail.title}》。`);
          return { text: `你读完后立刻后悔知道得太清楚：\n${mail.body}` };
        }
      },
      {
        label: '用指腹把火漆按牢',
        detail: '守住邮政秘密，提升对应岛屿的隐性信任。',
        outcome: (_s, mail) => ({
          text: '你把封蜡按回原处。秘密仍然是秘密，哪怕它在船舱里发烫。',
          effects: mail ? { relations: { [mail.from]: 2 } as Partial<Record<keyof GameState['relations'], number>> } : {}
        })
      }
    ]
  }
];

export const PORT_EVENTS: GameEvent[] = [
  {
    id: 'brine-customs',
    title: '税关小艇靠舷',
    context: '咸望堡的税关小艇横在邮船前。检查员敲了敲船仓：“例行验信。邮政封缄也不代表海不关心货物。”',
    trigger: 'port',
    priority: 10,
    condition: (s, ctx) => ctx?.island === 'brinewatch' && !s.flags.customsSearched && s.hour > 18,
    choices: (s) => {
      const openedSecret = s.mails.some((m) => m.status === 'accepted' && m.to === 'brinewatch' && m.opened && m.secrecy === '机密');
      return [
      {
        label: '配合检查所有清单',
        detail: openedSecret ? '拆动机密公文已暴露：将罚款 10 银币。' : '缴纳 3 银币核验费，并提升咸望堡信任。',
        condition: (s) => ({
          ok: s.silver >= (s.mails.some((m) => m.status === 'accepted' && m.to === 'brinewatch' && m.opened && m.secrecy === '机密') ? 10 : 3),
          reason: '银币不够支付核验/罚款费用'
        }),
        outcome: (s) => {
          const openedSecret = s.mails.some((m) => m.status === 'accepted' && m.to === 'brinewatch' && m.opened && m.secrecy === '机密');
          s.flags.customsSearched = true;
          if (openedSecret) {
            log(s, '事件', '税关发现你携带被拆动的机密公文。');
            return { text: '检查员发现机密封口有折痕，罚款 10 银币，并做了记录。', effects: { silver: -10, relations: { brinewatch: 2, thorn: -2 } } };
          }
          return { text: '检查耗时，但清单清楚。你缴纳 3 银币停泊核验费，税关对你点了点头。', effects: { silver: -3, relations: { brinewatch: 5 } } };
        }
      },
      {
        label: '递上 8 银币“快速通行费”',
        detail: '快速离开，但若暴露会严重恶化关系。',
        condition: (s) => ({ ok: s.silver >= 8, reason: '银币不够。' }),
        outcome: (s) => {
          s.flags.customsSearched = true;
          s.flags.bribedCustoms = true;
          const caught = s.relations.brinewatch < 35;
          if (caught) {
            return { text: '检查员把钱摔回甲板，认为这是侮辱。你仍被登记，8 银币也被当作保证金扣下。', effects: { silver: -8, relations: { brinewatch: -10, thorn: 2 } } };
          }
          return { text: '银币消失在手套里，小艇让开一条缝。棘木湾会欣赏这种做法，咸望堡未必永远不知道。', effects: { silver: -8, relations: { brinewatch: 1, thorn: 4 } } };
        }
      },
      {
        label: '引用邮政总局豁免权',
        detail: '无需费用，但关系可能下降。',
        outcome: (s) => {
          s.flags.customsSearched = true;
          return { text: '你把总局木牌举得很高。检查员没有上船，却在本子上写了很久。', effects: { relations: { brinewatch: -4, tidehome: 1 } } };
        }
      }
    ];
    }
  },
  {
    id: 'brine-mayor-blue-glass',
    title: '侧门后的蓝玻璃',
    context: '晚宴还没开始，市长的仆人把你带到侧门。三只蓝玻璃灯罩在布包里发光，和清单上“不存在”的数目正好相同。',
    trigger: 'port',
    priority: 9,
    condition: (s, ctx) => Boolean(ctx?.island === 'brinewatch' && s.flags.customsSearched && !s.flags.mayorOffered),
    choices: () => [
      {
        label: '收下 12 银币，保持沉默',
        detail: '立即获利；后续灯枝岛可能发现少货。',
        outcome: (s) => {
          s.flags.mayorOffered = true;
          s.flags.blueGlassSilent = true;
          return { text: '银币很冷，蓝玻璃很暖。你离开时，灯塔仍像什么都不知道。', effects: { silver: 12, relations: { brinewatch: 4, lantern: -4, thorn: 2 } } };
        }
      },
      {
        label: '把短笺按正规邮路交给收件人',
        detail: '拒绝共谋，提升灯枝岛信任。',
        outcome: (s) => {
          s.flags.mayorOffered = true;
          s.flags.blueGlassReported = true;
          return { text: '你让晚宴短笺留在邮袋里，不替任何人先走侧门。', effects: { relations: { lantern: 6, brinewatch: -4 } } };
        }
      }
    ]
  },
  {
    id: 'thorn-smuggler-parcel',
    title: '黑树下的无戳包裹',
    context: '棘木湾引航员青棘把一个没有邮戳的油布包放在桌上：“鸥栖屿的老人等它。官方航线不存在，所以我需要一位真正的邮差。”',
    trigger: 'port',
    priority: 8,
    condition: (s, ctx) => ctx?.island === 'thorn' && !s.flags.smugglerDealt,
    choices: () => [
      {
        label: '接受无戳包裹',
        detail: '新增一封机密急件去鸥栖屿，报酬高；不能再假装它不存在。',
        outcome: (s) => {
          s.flags.smugglerDealt = true;
          s.mails.push({
            id: `smuggled-${s.runId}`,
            from: 'thorn',
            to: 'gull',
            title: '没有邮戳的油布包',
            sender: '青棘',
            recipient: '观潮老人',
            weight: 1,
            reward: 30,
            deadline: Math.min(s.maxHour - 12, s.hour + 30),
            secrecy: '机密',
            summary: '摸起来像一叠被蜡封住的铜页。',
            body: '第二回流的振幅记录。不要让咸望堡抄走，否则他们会封掉鸥栖屿。',
            status: 'accepted',
            acceptedAt: s.hour,
            special: 'smuggled'
          });
          log(s, '信件', '你接下一封没有邮戳的机密包裹。');
          const trusted = s.relations.thorn >= 65;
          if (trusted) s.flags.hiddenChartKnown = true;
          return {
            text: trusted ? '青棘看了你一会儿，又补了一句暗礁航线的转向点。包裹已上船。' : '油布包被塞进船舱最底层。青棘只说：“潮会催你。”',
            effects: { relations: { thorn: 5 } }
          };
        }
      },
      {
        label: '拒绝无戳货物',
        detail: '保持清白，但棘木湾会失望。',
        outcome: (s) => {
          s.flags.smugglerDealt = true;
          return { text: '青棘点点头，像早料到邮差总会先看规章。', effects: { relations: { thorn: -3, brinewatch: 2 } } };
        }
      },
      {
        label: '要求 18 银币预付款',
        detail: '需要较高棘木湾关系。',
        condition: (s) => ({ ok: s.relations.thorn >= 55, reason: '青棘还不够信任你，不会先付钱。' }),
        outcome: (s) => {
          s.flags.smugglerDealt = true;
          s.flags.hiddenChartKnown = true;
          s.mails.push({
            id: `smuggled-${s.runId}-prepaid`,
            from: 'thorn',
            to: 'gull',
            title: '没有邮戳的油布包',
            sender: '青棘',
            recipient: '观潮老人',
            weight: 1,
            reward: 24,
            deadline: Math.min(s.maxHour - 12, s.hour + 30),
            secrecy: '机密',
            summary: '摸起来像一叠被蜡封住的铜页。',
            body: '第二回流的振幅记录。不要让咸望堡抄走，否则他们会封掉鸥栖屿。',
            status: 'accepted',
            acceptedAt: s.hour,
            special: 'smuggled'
          });
          return { text: '青棘笑了：“这才像黑树湾的朋友。”包裹上船，预付款也落袋。', effects: { silver: 18, relations: { thorn: 3 }, flags: { smugglerPrepaid: true } } };
        }
      }
    ]
  },
  {
    id: 'crab-festival',
    title: '红蟹节的第一通鼓',
    context: '铜锣师站在码头，数十只红蟹壳被敲得像晚霞落地。他说：“鼓谱到了，就该由带来节拍的人敲第一通。”',
    trigger: 'port',
    priority: 7,
    condition: (s, ctx) => ctx?.island === 'crab' && !s.flags.festivalDone && s.hour >= 44 && s.hour <= 124,
    choices: (s) => [
      {
        label: '参加两节潮时的庆典',
        detail: '花费 2 小时、5 银币，大幅提升关系并获得火漆。',
        condition: (s) => ({ ok: s.silver >= 5, reason: '连一份烤蟹饼都买不起。' }),
        outcome: (s) => {
          s.flags.festivalDone = true;
          s.sealKits += 1;
          return { text: '你敲错了半拍，岛民却高兴地跟着错。铜锣师送你一盒庆典火漆。', effects: { delayHours: 2, silver: -5, relations: { crab: 8, saltmere: 2, thorn: 2 }, flags: { festivalJoined: true } } };
        }
      },
      {
        label: '交还鼓谱后立刻赶潮',
        detail: '小幅提升关系，不延误。',
        outcome: (s) => {
          s.flags.festivalDone = true;
          return { text: '铜锣师有些遗憾，但让最熟节奏的少年替你敲下第一通。', effects: { relations: { crab: 3 } } };
        }
      }
    ]
  },
  {
    id: 'crab-castaway-reward',
    title: '少年的父亲等在码头',
    context: '被你救起的少年拖着一名魁梧蟹商跑来。后者什么也没说，先把一串银币和两只蟹油桶塞进你怀里。',
    trigger: 'port',
    priority: 11,
    condition: (s, ctx) => Boolean(ctx?.island === 'crab' && s.flags.castawayRescued && !s.flags.castawayRewarded),
    choices: () => [
      {
        label: '收下谢意',
        detail: '获得银币与燃料。',
        outcome: (s) => {
          s.flags.castawayRewarded = true;
          return { text: '蟹商说：“海上救人的债，不能让潮水记账。”', effects: { silver: 10, fuel: 6, relations: { crab: 6 } } };
        }
      }
    ]
  },
  {
    id: 'gull-clockmaker',
    title: '观潮老人的旧时计',
    context: '老人把齿轮装回一只黄铜时计。七分钟的误差在七个潮日后被修正，他把时计抛给你：“你比它准时。”',
    trigger: 'port',
    priority: 9,
    condition: (s, ctx) => ctx?.island === 'gull' && !s.tools.chronometer && s.mails.some((m) => m.id === 'm-lantern-gull-parts' && m.status === 'delivered'),
    choices: () => [
      {
        label: '接过旧时计',
        detail: '获得精密时计。',
        outcome: (s) => {
          s.tools.chronometer = true;
          log(s, '事件', '观潮老人把精密时计送给你。');
          return { text: '从此预计航线会精确到小时。秒针走得像一只很小的海鸟。' };
        }
      }
    ]
  },
  {
    id: 'tide-will-warning',
    title: '莫恩看着那封遗嘱',
    context: '老局长没有伸手要遗嘱，只看着火漆上的裂痕。“邮差最重要的航线，是从知道秘密到装作不知道之间。”',
    trigger: 'port',
    priority: 12,
    condition: (s, ctx) => ctx?.island === 'tidehome' && !s.flags.willConfronted && s.mails.some((m) => m.special === 'will' && m.opened),
    choices: () => [
      {
        label: '承认自己拆了信',
        detail: '严重影响潮汐港关系，但获得明确线索。',
        outcome: (s) => {
          s.flags.willConfronted = true;
          return { text: '莫恩沉默很久，告诉你抽屉后的铜牌仍会等一个值得信任的人——但那个人这次不是你。', effects: { relations: { tidehome: -12 }, flags: { willConfessed: true } } };
        }
      },
      {
        label: '说火漆是被潮水弄裂的',
        detail: '谎言会留下更差的结局评价。',
        outcome: (s) => {
          s.flags.willConfronted = true;
          s.flags.willLied = true;
          return { text: '莫恩点头，表示相信。你忽然希望他真的不相信。', effects: { relations: { tidehome: -8 }, flags: { willLied: true } } };
        }
      }
    ]
  },
  {
    id: 'tide-old-memory',
    title: '旧日志里的你',
    context: '新一轮潮邮开始后，莫恩翻到一页旧日志。那上面记录着上一位邮差犯过的错、救过的人，以及没有送到的信。',
    trigger: 'port',
    priority: 1,
    condition: (s, ctx) => ctx?.island === 'tidehome' && s.cycle > 1 && !s.flags.memoryTalked,
    choices: () => [
      {
        label: '听他念完上一轮记录',
        detail: '获得 8 银币修补款，并确认多周目记忆仍在。',
        outcome: (s) => {
          s.flags.memoryTalked = true;
          return { text: '潮水会重复，选择不会完全重复。莫恩给你 8 银币，让你这次少欠一点风。', effects: { silver: 8 } };
        }
      }
    ]
  }
];

function evaluateChoices(event: GameEvent, state: GameState, mail?: Mail) {
  return event.choices(state, mail).map((choice) => {
    const check = choice.condition?.(state, mail) ?? { ok: true };
    return { ...choice, disabled: check.ok ? undefined : check.reason ?? '现在不能选择' };
  });
}

export function getPortEvent(state: GameState, island: EventContext['island']): GameEvent | undefined {
  return PORT_EVENTS
    .filter((e) => e.condition?.(state, { island }))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
}

export function getForcedRouteEvent(state: GameState, ctx: Required<Pick<EventContext, 'from' | 'to' | 'routeId'>>): GameEvent | undefined {
  return EVENTS.find((e) => e.trigger === 'route' && e.condition?.(state, ctx));
}

export function pickRouteEvent(state: GameState, ctx: Required<Pick<EventContext, 'from' | 'to' | 'routeId'>>, rng: () => number): GameEvent | undefined {
  const pool = EVENTS.filter((e) => e.trigger === 'route' && (!e.condition || e.condition(state, ctx)));
  const total = pool.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  if (total <= 0 || rng() > 0.42) return undefined;
  let roll = rng() * total;
  for (const event of pool) {
    roll -= event.weight ?? 1;
    if (roll <= 0) return event;
  }
  return pool[0];
}

export function eventChoicesFor(event: GameEvent, state: GameState, mail?: Mail) {
  let candidate = mail;
  if (!candidate) {
    if (event.id === 'loose-seal') {
      candidate = state.mails.find((m) => m.status === 'accepted' && !m.opened && (m.secrecy === '私密' || m.secrecy === '机密'));
    }
  }
  return evaluateChoices(event, state, candidate).map((choice) => ({
    label: choice.label,
    detail: choice.detail,
    disabled: choice.disabled,
    run: () => choice.outcome(state, candidate)
  }));
}

export function islandEventHint(state: GameState, islandId: keyof GameState['relations']): string | undefined {
  const event = getPortEvent(state, islandId);
  if (!event) return undefined;
  return `${ISLAND_MAP[islandId].name}有事件：${event.title}`;
}
