/*
 * Правила и состояние партии: игроки, колоды, бой, непотребства, ИИ соперников.
 * Отрисовка — в ui.js. Ход игры — асинхронный цикл loop(): человек ждёт кнопок
 * через waitFor(), боты ходят сами с паузами sleep().
 */
'use strict';

const rnd = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickOne = (a) => a[rnd(a.length)];
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const sign = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');

let G = null;      // текущая партия
let T = null;      // текущий сеттинг (SETS[...])
let SPEED = 1;
let uid = 0;

const DOOR_KINDS = new Set(['monster', 'enh', 'curse', 'race', 'class', 'wander', 'ally', 'super', 'half']);

// Пауза, которая обрывает старую партию, если началась новая.
function sleep(ms) {
  const g = G;
  return new Promise((res, rej) => setTimeout(() => (G === g ? res() : rej(new Error('abort'))), ms * SPEED));
}

/* ---------------- колоды и игроки ---------------- */

function buildDecks(theme, exps) {
  const th = SETS[theme];
  const door = [], tre = [];
  const add = (arr, list) => list.forEach((c) => arr.push({ ...c, uid: ++uid }));
  add(door, th.base.door); add(tre, th.base.treasure);
  exps.forEach((k) => { add(door, th.exp[k].door); add(tre, th.exp[k].treasure); });
  door.forEach((c) => {
    if (c.kind === 'race') { [c.name, c.e] = th.races[c.key]; }
    if (c.kind === 'class') { [c.name, c.e] = th.classes[c.key]; }
  });
  return { door: shuffle(door), tre: shuffle(tre) };
}

function mkPlayer(name, sex, human, av) {
  return { id: G.players.length, name, sex, human, av, level: 1, races: [], classes: [], extras: [],
    eq: [], bag: [], hand: [], steed: null, ally: null, weak: 0 };
}

function draw(type) {
  const deck = type === 'door' ? G.door : G.tre;
  const disc = type === 'door' ? G.doorD : G.treD;
  if (!deck.length) {
    if (!disc.length) return null;
    deck.push(...shuffle(disc.splice(0)));
    log(`Колода ${type === 'door' ? 'дверей' : 'сокровищ'} перетасована.`, 'sys');
  }
  return deck.pop();
}
function discard(c) { if (c) (DOOR_KINDS.has(c.kind) ? G.doorD : G.treD).push(c); }
function takeFromHand(p, c) { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); return c; }

/* ---------------- свойства героя ---------------- */

const hasRace = (p, k) => p.races.some((c) => c.key === k);
const hasCls = (p, k) => p.classes.some((c) => c.key === k);
const raceStr = (p) => (p.races.length ? p.races.map((c) => c.name).join(' / ') : T.human);
const clsStr = (p) => (p.classes.length ? p.classes.map((c) => c.name).join(' / ') : 'без класса');
const maxRaces = (p) => (p.extras.some((c) => c.kind === 'half') ? 2 : 1);
const maxClasses = (p) => (p.extras.some((c) => c.kind === 'super') ? 2 : 1);

function reqOk(p, c) {
  if (c.only) {
    if (c.only.cls && !hasCls(p, c.only.cls)) return false;
    if (c.only.race && !hasRace(p, c.only.race)) return false;
    if (c.only.sex && p.sex !== c.only.sex) return false;
  }
  if (c.no && c.no.cls && hasCls(p, c.no.cls)) return false;
  return true;
}
function reqText(c) {
  if (c.only) {
    if (c.only.cls) return 'Только: ' + T.classes[c.only.cls][0];
    if (c.only.race) return 'Только: ' + T.races[c.only.race][0];
    if (c.only.sex) return c.only.sex === 'f' ? 'Только для дам' : 'Только для мужчин';
  }
  if (c.no && c.no.cls) return 'Не для: ' + T.classes[c.no.cls][0];
  return '';
}

const bigCount = (p) => [...p.eq, ...p.bag].filter((c) => c.big).length;
const canCarryBig = (p) => hasRace(p, 'dwarf') || bigCount(p) === 0;
const handsUsed = (p) => sum(p.eq, (c) => (c.slot === 'hand' ? 1 : c.slot === 'hands2' ? 2 : 0));
function slotFree(p, c) {
  if (c.slot === 'none') return true;
  if (c.slot === 'hand') return handsUsed(p) <= 1;
  if (c.slot === 'hands2') return handsUsed(p) === 0;
  return !p.eq.some((x) => x.slot === c.slot);
}
function equipProblem(p, c, fromBag) {
  if (!reqOk(p, c)) return 'Не подходит: ' + reqText(c);
  if (!slotFree(p, c)) return 'Место «' + SLOT_NAMES[c.slot] + '» занято';
  if (c.big && !fromBag && !canCarryBig(p)) return 'У вас уже есть Большая шмотка';
  return null;
}

const itemB = (p, c) => (reqOk(p, c) ? c.b : 0);
function gear(p) {
  let s = sum(p.eq, (c) => itemB(p, c));
  if (p.steed) s += p.steed.b;
  if (p.ally) s += p.ally.b;
  return s;
}
const power = (p) => p.level + gear(p);
function runB(p) {
  let s = hasRace(p, 'elf') ? 1 : 0;
  p.eq.forEach((c) => { if (c.run && reqOk(p, c)) s += c.run; });
  if (p.steed) s += p.steed.run || 0;
  if (p.ally) s += p.ally.run || 0;
  return s;
}
const handLimit = (p) => (hasRace(p, 'dwarf') ? 6 : 5);
const maxLevel = () => Math.max(...G.players.map((p) => p.level));
const isLeader = (p) => p.level >= maxLevel();
const others = (p) => G.players.filter((x) => x !== p);

/* ---------------- бой: подсчёт ---------------- */

function vsBonus(mon, p) {
  if (!p) return 0;
  return sum(mon.vs || [], (v) =>
    ((v.race && hasRace(p, v.race)) || (v.cls && hasCls(p, v.cls)) || (v.sex && p.sex === v.sex)) ? v.m : 0);
}
const sideStr = (c) => power(c.fighter) - c.fighter.weak + c.pB + (c.helper ? power(c.helper) : 0);
const monOne = (c, m) => m.card.lvl + sum(m.enh, (e) => e.m) + vsBonus(m.card, c.fighter) + vsBonus(m.card, c.helper);
const monStr = (c) => Math.max(0, sum(c.mons, (m) => monOne(c, m)) + c.mB);
const warSide = (c) => hasCls(c.fighter, 'warrior') || (c.helper && hasCls(c.helper, 'warrior'));
const winning = (c) => (warSide(c) ? sideStr(c) >= monStr(c) : sideStr(c) > monStr(c));
// сколько силы не хватает бойцу до победы (≤0 — уже побеждает)
const needToWin = (c) => monStr(c) - sideStr(c) + (warSide(c) ? 0 : 1);
// сколько надо добавить монстру, чтобы боец проиграл (≤0 — уже проигрывает)
const needToLose = (c) => sideStr(c) - monStr(c) + (warSide(c) ? 1 : 0);
const hasUndead = (c) => c.mons.some((m) => m.card.u);
const treasureCount = (c) => sum(c.mons, (m) => Math.max(0, m.card.t + sum(m.enh, (e) => e.t)));
const levelCount = (c) => sum(c.mons, (m) => m.card.lv || 1);
const monNames = (c) => c.mons.map((m) => (m.enh.length ? m.enh.map((e) => e.name).join(' ') + ' ' : '') + m.card.name).join(' + ');
const shotVal = (x, c) => (x.bu && hasUndead(c) ? x.bu : x.b);

/* ---------------- непотребства, проклятия, смерть ---------------- */

function loseBest(p, list, label) {
  if (!list.length) return false;
  const c = list.slice().sort((a, b) => b.b - a.b || b.v - a.v)[0];
  let i = p.eq.indexOf(c); if (i >= 0) p.eq.splice(i, 1);
  i = p.bag.indexOf(c); if (i >= 0) p.bag.splice(i, 1);
  discard(c);
  log(`${p.name} теряет ${label}: «${c.name}».`, 'bad');
  return true;
}

function applyBad(p, bad, source) {
  const codes = Array.isArray(bad) ? bad : [bad];
  for (const code of codes) {
    switch (code) {
      case 'L1': case 'L2': case 'L3': {
        const n = +code[1], old = p.level;
        p.level = Math.max(1, p.level - n);
        log(`${p.name} теряет ${old - p.level || 0} ур. (${source}).`, 'bad');
        break;
      }
      case 'head': case 'armor': case 'feet':
        if (!loseBest(p, p.eq.filter((c) => c.slot === code), SLOT_NAMES[code].toLowerCase())) log(`${p.name}: терять нечего — повезло.`, 'sys');
        break;
      case 'hands':
        if (!loseBest(p, p.eq.filter((c) => c.slot === 'hand' || c.slot === 'hands2'), 'шмотку из рук')) log(`${p.name}: в руках пусто — повезло.`, 'sys');
        break;
      case 'big':
        if (!loseBest(p, [...p.eq, ...p.bag].filter((c) => c.big), 'Большую шмотку')) log(`${p.name}: Больших шмоток нет — повезло.`, 'sys');
        break;
      case 'best':
        if (!loseBest(p, p.eq.length ? p.eq : p.bag, 'лучшую шмотку')) log(`${p.name}: шмоток нет — повезло.`, 'sys');
        break;
      case 'race':
        if (p.races.length) { log(`${p.name} теряет расу: ${raceStr(p)}.`, 'bad'); p.races.splice(0).forEach(discard); }
        break;
      case 'class':
        if (p.classes.length) { log(`${p.name} теряет класс: ${clsStr(p)}.`, 'bad'); p.classes.splice(0).forEach(discard); }
        break;
      case 'card1': case 'card2': {
        const n = Math.min(+code[4], p.hand.length);
        for (let i = 0; i < n; i++) discard(p.hand.splice(rnd(p.hand.length), 1)[0]);
        if (n) log(`${p.name} сбрасывает ${n} карт(ы) с руки.`, 'bad');
        break;
      }
      case 'hand':
        if (p.hand.length) { log(`${p.name} сбрасывает всю руку (${p.hand.length}).`, 'bad'); p.hand.splice(0).forEach(discard); }
        break;
      case 'steed':
        if (p.steed) { log(`${p.name} теряет скакуна «${p.steed.name}».`, 'bad'); discard(p.steed); p.steed = null; }
        break;
      case 'ally':
        if (p.ally) { log(`${p.name} теряет подручного «${p.ally.name}».`, 'bad'); discard(p.ally); p.ally = null; }
        break;
      case 'sex':
        p.sex = p.sex === 'm' ? 'f' : 'm'; p.weak += 5;
        log(`${p.name} меняет пол! −5 в следующем бою.`, 'bad');
        if (p.human) p.av = T.you[p.sex];
        break;
      case 'weak3': case 'weak5':
        p.weak += +code[4];
        log(`${p.name}: −${code[4]} в следующем бою.`, 'bad');
        break;
      case 'death':
        kill(p, source);
        break;
    }
  }
}

function kill(p, source) {
  log(`☠ ${p.name} погибает (${source})! Шмотки и рука потеряны, уровень, раса и класс остаются.`, 'bad');
  [...p.eq, ...p.bag, ...p.hand].forEach(discard);
  if (p.steed) discard(p.steed);
  if (p.ally) discard(p.ally);
  p.eq = []; p.bag = []; p.hand = []; p.steed = null; p.ally = null;
  for (let i = 0; i < 2; i++) { const d = draw('door'); if (d) p.hand.push(d); }
  for (let i = 0; i < 2; i++) { const t = draw('tre'); if (t) p.hand.push(t); }
  if (p.human) toast('Вы погибли… Но манчкины не сдаются: новые 4 карты на руку.', 'bad');
}

/* ---------------- розыгрыш карт (общий для человека и ботов) ---------------- */

function equip(p, c, fromBag) {
  if (fromBag) p.bag.splice(p.bag.indexOf(c), 1); else takeFromHand(p, c);
  p.eq.push(c);
}
function playRaceClass(p, c) {
  takeFromHand(p, c);
  if (c.kind === 'super' || c.kind === 'half') { p.extras.push(c); log(`${p.name} играет «${c.name}».`); return; }
  const list = c.kind === 'race' ? p.races : p.classes;
  const max = c.kind === 'race' ? maxRaces(p) : maxClasses(p);
  if (list.length >= max) discard(list.shift());
  list.push(c);
  log(`${p.name} теперь ${c.kind === 'race' ? raceStr(p) : clsStr(p)}.`);
}
function playSteedAlly(p, c) {
  takeFromHand(p, c);
  const key = c.kind === 'steed' ? 'steed' : 'ally';
  if (p[key]) discard(p[key]);
  p[key] = c;
  log(`${p.name} ${key === 'steed' ? 'седлает' : 'нанимает'} «${c.name}».`);
}
function playLevelUp(p, c) {
  if (p.level >= 9) return false;
  takeFromHand(p, c); discard(c); p.level++;
  log(`${p.name}: «${c.name}» — +1 уровень (${p.level}).`, 'good');
  return true;
}
function castCurse(from, target, c) {
  takeFromHand(from, c);
  log(`${from.name} проклинает ${target.name}: «${c.name}».`, 'bad');
  applyBad(target, c.eff, c.name);
  discard(c);
}
function useShot(p, c, side, comb) {
  takeFromHand(p, c); discard(c);
  const v = side === 'side' ? shotVal(c, comb) : c.b;
  if (side === 'side') comb.pB += v; else comb.mB += v;
  log(`${p.name} использует «${c.name}» ${side === 'side' ? 'за бойца' : 'за монстра'} (${sign(v)}).`, side === 'side' ? 'good' : 'bad');
}
function useEnh(p, c, comb, idx = 0) {
  takeFromHand(p, c);
  comb.mons[idx].enh.push(c);
  log(`${p.name} играет «${c.name}» на ${comb.mons[idx].card.name} (${sign(c.m)}).`, c.m > 0 ? 'bad' : 'good');
}
function useWander(p, w, mon, comb) {
  takeFromHand(p, w); takeFromHand(p, mon); discard(w);
  comb.mons.push({ card: mon, enh: [] });
  log(`${p.name}: «${w.name}» — в бой вступает ${mon.name} (ур. ${mon.lvl})!`, 'bad');
}
function sellItems(p, items) {
  let total = sum(items, (c) => c.v || 0);
  let dbl = false;
  if (hasRace(p, 'halfling') && !G.flags.halfDouble && items.length) {
    total += Math.max(...items.map((c) => c.v || 0)); dbl = true;
  }
  const lv = Math.min(Math.floor(total / 1000), 9 - p.level);
  if (lv <= 0) return 0;
  items.forEach((c) => {
    for (const arr of [p.hand, p.bag, p.eq]) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
    if (p.steed === c) p.steed = null;
    discard(c);
  });
  if (dbl) G.flags.halfDouble = true;
  p.level += lv;
  log(`${p.name} продаёт шмотки на ${total} зол. → +${lv} ур. (${p.level}).`, 'good');
  return lv;
}

/* ---------------- ход партии ---------------- */

async function loop() {
  const g = G;
  try {
    while (!g.winner) {
      const p = g.players[g.turn];
      g.cur = p; g.flags = { halfDouble: false };
      log(`Ход ${g.round} — ${p.name}`, 'turn');
      render();
      if (p.human) await humanTurn(p); else await botTurn(p);
      if (g.winner) break;
      g.turn = (g.turn + 1) % g.players.length;
      if (g.turn === 0) g.round++;
    }
    if (G === g) { render(); showWinner(); }
  } catch (e) {
    if (e.message !== 'abort') { console.error(e); toast('Ошибка: ' + e.message, 'bad'); }
  }
}

function waitFor(actions) {
  G.awaiting = actions;
  render();
  return new Promise((res) => { G.resolver = res; });
}
function act(a) {
  if (G && G.resolver && G.awaiting.includes(a)) {
    const r = G.resolver; G.resolver = null; G.awaiting = [];
    r(a);
  }
}

async function humanTurn(p) {
  G.phase = 'wait';
  await botsCurse(p);
  G.phase = 'prep';
  await waitFor(['kick']);
  const card = draw('door');
  G.reveal = { card, who: p, note: 'Вы вышибли дверь' };
  log(`${p.name} вышибает дверь: ${card.name}.`);
  let fought = false;
  if (card.kind === 'monster') { fought = true; await combat(p, [card]); }
  else if (card.kind === 'curse') { applyBad(p, card.eff, card.name); discard(card); toast('Проклятие! ' + card.text, 'bad'); }
  else { p.hand.push(card); toast(`«${card.name}» уходит вам на руку.`); }
  if (G.winner) return;
  if (!fought) {
    G.phase = 'after';
    for (;;) {
      const a = await waitFor(['trouble', 'loot']);
      if (a === 'loot') {
        const d = draw('door'); p.hand.push(d);
        G.reveal = { card: null, who: p, note: 'Вы чистите нычки: карта двери на руку' };
        log(`${p.name} чистит нычки (взакрытую берёт дверь).`);
        toast(`Из нычки: «${d.name}»`);
        break;
      }
      const mons = p.hand.filter((c) => c.kind === 'monster');
      const m = await pickCard(mons, 'С кем подраться?', 'Выберите монстра с руки');
      if (!m) continue;
      takeFromHand(p, m);
      log(`${p.name} ищет неприятности!`);
      await combat(p, [m]);
      break;
    }
  }
  if (G.winner) return;
  G.phase = 'end';
  await waitFor(['end']);
  if (p.hand.length > handLimit(p)) {
    G.phase = 'charity';
    await waitFor(['charityDone']);
  }
  G.phase = 'wait';
}

// Благотворительность: лишняя карта уходит самому слабому сопернику (или в сброс, если слабейший — вы).
function charityGive(p, c) {
  takeFromHand(p, c);
  const others_ = others(p);
  const minL = Math.min(...others_.map((x) => x.level));
  if (p.level <= minL) { discard(c); log(`${p.name} сбрасывает «${c.name}».`); return; }
  const to = pickOne(others_.filter((x) => x.level === minL));
  to.hand.push(c);
  log(`${p.name} отдаёт «${c.name}» → ${to.name} (благотворительность).`);
}

/* ---------------- бой ---------------- */

async function combat(f, cards) {
  const c = { fighter: f, helper: null, share: 0, mons: cards.map((card) => ({ card, enh: [] })), pB: 0, mB: 0,
    flight: 0, berserk: 0, turned: 0, backstab: new Set(), asked: new Set(), end: null, result: '' };
  G.combat = c; G.reveal = null;
  log(`⚔ ${f.name} против: ${monNames(c)} (ур. ${monStr(c)}).`, 'fight');
  render();
  if (f.human) await humanCombat(c); else await botCombat(c);
  c.mons.forEach((m) => { discard(m.card); m.enh.forEach(discard); });
  f.weak = 0;
  G.reveal = { card: c.mons[0].card, who: f, note: c.result };
  G.combat = null;
  render();
}

async function humanCombat(c) {
  const p = c.fighter;
  for (;;) {
    G.phase = 'combat';
    const a = await waitFor(['fight', 'help', 'run', 'charm', 'sacrifice', 'potion']);
    if (a === 'potion') {
      if (c.end === 'escape') { c.result = 'Смылся'; log(`${p.name} растворяется в воздухе — смылся!`, 'good'); break; }
      if (c.end === 'friend') { c.result = 'Монстр ушёл'; log(`Монстры уходят с миром. Сокровищ нет.`); break; }
      continue;
    }
    if (a === 'help') { await humanAskHelp(c); continue; }
    if (a === 'fight') {
      if (!winning(c)) { toast('Силёнок маловато!'); continue; }
      G.phase = 'wait'; render();
      await sleep(500);
      if (botsInterfere(c)) { render(); toast('Соперники вмешались в бой!', 'bad'); continue; }
      await resolveWin(c);
      c.result = 'Победа!';
      break;
    }
    if (a === 'run') { G.phase = 'wait'; render(); await runAway(c); c.result = 'Смывка'; break; }
    if (a === 'charm') {
      const tc = treasureCount(c);
      p.hand.splice(0).forEach(discard);
      const loot = drawLoot(tc);
      p.hand.push(...loot);
      log(`${p.name}: ${T.btn.charm}! Монстр уходит, сокровищ: ${loot.length}.`, 'good');
      c.result = T.btn.charm;
      if (loot.length) await showCards(loot, 'Добыча');
      break;
    }
    if (a === 'sacrifice') {
      log(`${p.name} жертвует подручным «${p.ally.name}» и сматывается.`);
      discard(p.ally); p.ally = null;
      c.result = 'Подручный пал смертью храбрых';
      break;
    }
  }
  G.phase = 'wait';
}

function drawLoot(n) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = draw('tre'); if (t) out.push(t); }
  return out;
}

async function resolveWin(c) {
  const f = c.fighter, lv = levelCount(c), tc = treasureCount(c);
  f.level = Math.min(10, f.level + lv);
  log(`🏆 ${f.name} побеждает: ${monNames(c)}! +${lv} ур. → ${f.level}.`, 'good');
  if (c.helper && hasRace(c.helper, 'elf') && c.helper.level < 9) {
    c.helper.level++;
    log(`${c.helper.name} (${T.races.elf[0]}) получает уровень за помощь.`, 'good');
  }
  const loot = drawLoot(tc);
  if (c.helper && c.share) {
    const part = loot.splice(0, Math.min(c.share, loot.length));
    c.helper.hand.push(...part);
    log(`${c.helper.name} получает свою долю: ${part.length} сокр.`);
    if (c.helper.human && part.length) await showCards(part, 'Ваша доля за помощь');
  }
  f.hand.push(...loot);
  if (f.human && loot.length) await showCards(loot, `Победа! +${lv} ур. Ваша добыча:`);
  else if (!f.human) await sleep(600);
  if (f.level >= 10) G.winner = f;
}

async function runAway(c) {
  const f = c.fighter;
  for (const m of c.mons) {
    const mc = m.card;
    if (mc.noPursue && f.level <= mc.noPursue) {
      log(`${mc.name} не стал гнаться за ${f.name} (ур. ≤${mc.noPursue}).`);
      continue;
    }
    const bonus = runB(f) + c.flight + (mc.run || 0);
    const roll = 1 + rnd(6);
    const ok = roll + bonus >= 5;
    log(`🎲 ${f.name} смывается от ${mc.name}: ${roll}${bonus ? ' ' + sign(bonus) : ''} — ${ok ? 'удалось!' : 'не вышло.'}`, ok ? 'good' : 'bad');
    await showDice(roll, bonus, ok, mc, f);
    if (!ok) {
      applyBad(f, mc.bad, mc.name);
      if (f.human) toast(`Непотребство: ${mc.badText}`, 'bad');
    }
    render();
  }
}

async function humanAskHelp(c) {
  const bots = G.players.filter((p) => !p.human && !c.asked.has(p.id));
  if (!bots.length) { toast('Больше просить некого.'); return; }
  const res = await askHelpDialog(c, bots);
  if (!res) return;
  const { bot, offer } = res;
  c.asked.add(bot.id);
  if (botAccept(bot, c, offer)) {
    c.helper = bot; c.share = offer;
    log(`${bot.name} соглашается помочь за ${offer} сокр.`, 'good');
    toast(`${bot.name}: «${pickOne(['Ладно, вместе веселее!', 'По рукам!', 'Держись, иду!'])}»`);
  } else {
    log(`${bot.name} отказывается помогать.`);
    toast(`${bot.name}: «${pickOne(['Ещё чего!', 'Сам справишься.', 'Маловато предлагаешь.', 'Я лучше посмотрю.'])}»`, 'bad');
  }
}

/* ---------------- ИИ соперников ---------------- */

function cardUse(p, x) {
  switch (x.kind) {
    case 'levelup': return 9;
    case 'oneshot': return 6;
    case 'enh': case 'curse': return 5;
    case 'wander': return 4;
    case 'monster': case 'ally': return 3;
    case 'item': case 'steed': return reqOk(p, x) ? 3 : 2;
    default: return 1;
  }
}
const fodder = (p, exclude = []) => p.hand.filter((x) => !exclude.includes(x)).sort((a, b) => cardUse(p, a) - cardUse(p, b));

function botAccept(bot, c, offer) {
  const f = c.fighter;
  if (f.level + levelCount(c) >= 10) return false;
  if (hasRace(bot, 'elf') && bot.level < 9) return Math.random() < 0.9;
  const want = isLeader(f) && f.level > bot.level ? 2 : 1;
  if (offer < want) return Math.random() < 0.15;
  return Math.random() < (isLeader(f) ? 0.55 : 0.85);
}

function botManage(p) {
  // уровни
  for (const c of p.hand.filter((x) => x.kind === 'levelup')) playLevelUp(p, c);
  // особые, расы, классы
  for (const c of p.hand.filter((x) => x.kind === 'super' || x.kind === 'half')) playRaceClass(p, c);
  for (const c of p.hand.filter((x) => x.kind === 'race')) if (p.races.length < maxRaces(p) && !hasRace(p, c.key)) playRaceClass(p, c);
  for (const c of p.hand.filter((x) => x.kind === 'class')) if (p.classes.length < maxClasses(p) && !hasCls(p, c.key)) playRaceClass(p, c);
  // скакуны и подручные
  for (const c of p.hand.filter((x) => x.kind === 'steed')) if (!p.steed || p.steed.b + (p.steed.run || 0) < c.b + c.run) playSteedAlly(p, c);
  for (const c of p.hand.filter((x) => x.kind === 'ally')) if (!p.ally || p.ally.b < c.b) playSteedAlly(p, c);
  // шмотки
  const items = [...p.hand, ...p.bag].filter((x) => x.kind === 'item' && reqOk(p, x)).sort((a, b) => b.b - a.b);
  for (const c of items) {
    const fromBag = p.bag.includes(c);
    if (!equipProblem(p, c, fromBag)) { equip(p, c, fromBag); continue; }
    if (c.big && !fromBag && !canCarryBig(p)) continue;
    // замена худшей шмотки того же типа
    let worse = [];
    if (['head', 'armor', 'feet'].includes(c.slot)) worse = p.eq.filter((x) => x.slot === c.slot);
    else if (c.slot === 'hand') { const h = p.eq.filter((x) => x.slot === 'hand').sort((a, b) => a.b - b.b); if (h.length === 2) worse = [h[0]]; else worse = p.eq.filter((x) => x.slot === 'hands2'); }
    else if (c.slot === 'hands2') worse = p.eq.filter((x) => x.slot === 'hand' || x.slot === 'hands2');
    if (worse.length && sum(worse, (x) => itemB(p, x)) < c.b) {
      worse.forEach((w) => { p.eq.splice(p.eq.indexOf(w), 1); p.bag.push(w); });
      if (!equipProblem(p, c, fromBag)) equip(p, c, fromBag);
    }
  }
}

function botSell(p) {
  if (p.level >= 9) return;
  const pool = [...p.bag, ...p.hand.filter((x) => (x.kind === 'item' || x.kind === 'steed') && x.v)].sort((a, b) => a.v - b.v);
  let total = sum(pool, (x) => x.v);
  if (hasRace(p, 'halfling') && pool.length) total += pool[pool.length - 1].v;
  const k = Math.min(Math.floor(total / 1000), 9 - p.level);
  if (k <= 0) return;
  // продаём от дешёвых, пока хватает на k уровней
  const pick = [];
  for (let i = pool.length - 1; i >= 0; i--) { pick.push(pool[i]); if (sellValue(p, pick) >= k * 1000) break; }
  sellItems(p, pick);
}
function sellValue(p, items) {
  let t = sum(items, (x) => x.v);
  if (hasRace(p, 'halfling') && items.length && !G.flags.halfDouble) t += Math.max(...items.map((x) => x.v));
  return t;
}

function botCharity(p) {
  while (p.hand.length > handLimit(p)) charityGive(p, fodder(p)[0]);
}

// Соперники могут проклясть игрока перед его ходом.
async function botsCurse(target) {
  for (const b of shuffle(G.players.filter((x) => !x.human && x !== target))) {
    const cur = b.hand.find((x) => x.kind === 'curse');
    if (!cur) continue;
    let prob = (isLeader(target) ? 0.5 : 0.15) * G.aggr;
    if (target.level >= 8) prob = 0.9;
    if (Math.random() > prob) continue;
    castCurse(b, target, cur);
    render();
    if (target.human) await showCards([cur], `${b.name} проклинает вас!`, 'Эх…');
    else await sleep(500);
  }
}

function botsInterfere(c) {
  let played = false;
  const f = c.fighter;
  for (const b of shuffle(G.players.filter((p) => !p.human && p !== f && p !== c.helper))) {
    if (!winning(c)) break;
    const wouldWin = f.level + levelCount(c) >= 10;
    let prob = (wouldWin ? 1 : isLeader(f) ? 0.45 : 0.15) * G.aggr;
    if (f.human && !wouldWin) prob *= 1.15;
    if (Math.random() > prob) continue;
    const opts = [];
    b.hand.forEach((x) => {
      if (x.kind === 'enh' && x.m > 0) opts.push({ t: 'enh', x, v: x.m });
      if (x.kind === 'oneshot' && x.b > 0) opts.push({ t: 'shot', x, v: x.b });
    });
    const w = b.hand.find((x) => x.kind === 'wander');
    const wm = b.hand.filter((x) => x.kind === 'monster').sort((a, z) => z.lvl - a.lvl)[0];
    if (w && wm) opts.push({ t: 'wander', x: w, m: wm, v: wm.lvl });
    if (hasCls(b, 'thief') && !c.backstab.has(b.id) && b.hand.length > opts.length) opts.push({ t: 'stab', v: 2 });
    let need = needToLose(c);
    if (sum(opts, (o) => o.v) < need && !wouldWin) continue;
    opts.sort((a, z) => z.v - a.v);
    for (const o of opts) {
      if (needToLose(c) <= 0) break;
      if (o.t === 'enh') useEnh(b, o.x, c);
      else if (o.t === 'shot') useShot(b, o.x, 'mon', c);
      else if (o.t === 'wander') useWander(b, o.x, o.m, c);
      else if (o.t === 'stab') {
        const fd = fodder(b)[0]; if (!fd) continue;
        takeFromHand(b, fd); discard(fd); c.pB -= 2; c.backstab.add(b.id);
        log(`${b.name}: ${T.btn.backstab}! ${f.name} получает −2.`, 'bad');
      }
      played = true;
    }
  }
  return played;
}

// Бот-боец пытается дотянуть до победы своими картами.
function botBoost(c) {
  const f = c.fighter;
  let need = needToWin(c);
  if (need <= 0) return;
  const opts = [];
  f.hand.forEach((x) => {
    if (x.kind === 'enh' && x.m < 0) opts.push({ t: 'enh', x, v: -x.m });
    if (x.kind === 'oneshot' && x.b > 0) opts.push({ t: 'shot', x, v: shotVal(x, c) });
  });
  const spare = fodder(f, opts.map((o) => o.x)).filter((x) => cardUse(f, x) <= 3);
  const war = hasCls(f, 'warrior') ? Math.min(3 - c.berserk, spare.length) : 0;
  const cler = hasCls(f, 'cleric') && hasUndead(c) ? Math.min(3 - c.turned, spare.length) : 0;
  const total = sum(opts, (o) => o.v) + Math.max(war, cler * 3);
  const dangerous = c.mons.some((m) => [].concat(m.card.bad).some((b) => ['death', 'L2', 'L3', 'hand', 'best'].includes(b)));
  if (total < need && !dangerous) return;
  if (total < need && Math.random() < 0.5) return;
  opts.sort((a, z) => z.v - a.v);
  for (const o of opts) {
    if (needToWin(c) <= 0) return;
    if (o.t === 'enh') useEnh(f, o.x, c); else useShot(f, o.x, 'side', c);
  }
  while (needToWin(c) > 0 && spare.length) {
    if (cler && c.turned < 3) { const d = spare.shift(); takeFromHand(f, d); discard(d); c.turned++; c.pB += 3; log(`${f.name}: ${T.btn.turn} (+3).`, 'good'); }
    else if (war && c.berserk < 3) { const d = spare.shift(); takeFromHand(f, d); discard(d); c.berserk++; c.pB += 1; log(`${f.name}: ${T.btn.berserk} (+1).`, 'good'); }
    else break;
  }
}

async function botAskHelp(c) {
  if (c.helper) return;
  const f = c.fighter;
  const need = needToWin(c);
  const tc = treasureCount(c);
  const offer = Math.max(1, Math.ceil(tc / 2));
  const cands = shuffle(others(f).filter((p) => power(p) >= need && !c.asked.has(p.id)));
  for (const h of cands) {
    c.asked.add(h.id);
    if (h.human) {
      if (f.level + levelCount(c) >= 10) continue; // к человеку с победным боем не идут — он же откажет… или нет?
      const yes = await helpRequestDialog(f, c, offer);
      if (yes) { c.helper = h; c.share = offer; log(`${h.name} помогает ${f.name} за ${offer} сокр.`, 'good'); return; }
      log(`${h.name} отказывает ${f.name}.`);
    } else if (botAccept(h, c, offer)) {
      c.helper = h; c.share = offer;
      log(`${f.name} зовёт на помощь ${h.name} (за ${offer} сокр.) — тот соглашается.`);
      return;
    }
  }
}

async function botCombat(c) {
  const f = c.fighter;
  await sleep(800);
  botBoost(c); render();
  if (!winning(c)) { await botAskHelp(c); render(); }
  if (winning(c) || c.helper === G.me) {
    const hi = await humanInterfere(c);
    const bi = winning(c) ? botsInterfere(c) : false;
    render();
    if (hi || bi) { await sleep(600); botBoost(c); if (!winning(c)) await botAskHelp(c); render(); }
  }
  await sleep(500);
  if (winning(c)) { await resolveWin(c); c.result = 'Победа!'; return; }
  // проигрывает
  const dangerous = c.mons.some((m) => [].concat(m.card.bad).some((b) => ['death', 'L2', 'L3', 'hand', 'best', 'race', 'class'].includes(b))) || f.level >= 7;
  if (hasCls(f, 'wizard') && f.hand.length >= 3 && c.mons.length === 1 && dangerous) {
    const tc = treasureCount(c);
    f.hand.splice(0).forEach(discard);
    f.hand.push(...drawLoot(tc));
    log(`${f.name}: ${T.btn.charm}! Монстр уходит, сокровища — ему.`, 'good');
    c.result = T.btn.charm; return;
  }
  const esc = f.hand.find((x) => x.kind === 'oneshot' && (x.eff === 'escape' || x.eff === 'friend'));
  if (esc && dangerous) {
    takeFromHand(f, esc); discard(esc);
    log(`${f.name} использует «${esc.name}» и избегает боя.`);
    c.result = 'Сбежал'; return;
  }
  if (f.ally && dangerous) {
    log(`${f.name} жертвует подручным «${f.ally.name}» и сматывается.`);
    discard(f.ally); f.ally = null; c.result = 'Сбежал'; return;
  }
  if (hasCls(f, 'wizard')) {
    const spare = fodder(f).filter((x) => cardUse(f, x) <= 3).slice(0, 3);
    spare.forEach((d) => { takeFromHand(f, d); discard(d); c.flight++; });
    if (spare.length) log(`${f.name}: ${T.btn.flight} (+${spare.length} к смывке).`);
  }
  await runAway(c);
  c.result = 'Смывка';
}

async function botTurn(p) {
  G.phase = 'wait';
  await botsCurse(p);
  botManage(p); render();
  await sleep(700);
  const card = draw('door');
  G.reveal = { card, who: p, note: `${p.name} вышибает дверь` };
  log(`${p.name} вышибает дверь: ${card.name}.`);
  render();
  await sleep(1000);
  let fought = false;
  if (card.kind === 'monster') { fought = true; await combat(p, [card]); }
  else if (card.kind === 'curse') { applyBad(p, card.eff, card.name); discard(card); }
  else p.hand.push(card);
  if (G.winner) return;
  if (!fought) {
    botManage(p);
    const pw = power(p) - p.weak;
    const m = p.hand.filter((x) => x.kind === 'monster' && x.lvl + 2 < pw).sort((a, b) => b.lvl - a.lvl)[0];
    if (m) {
      takeFromHand(p, m);
      log(`${p.name} ищет неприятности!`);
      await combat(p, [m]);
    } else {
      const d = draw('door'); if (d) p.hand.push(d);
      G.reveal = { card: null, who: p, note: `${p.name} чистит нычки` };
      log(`${p.name} чистит нычки.`);
      render(); await sleep(600);
    }
  }
  if (G.winner) return;
  botManage(p); botSell(p); botCharity(p);
  render();
  await sleep(600);
}

async function humanInterfere(c) {
  const me = G.me;
  if (!me.human) return false;
  if (!G.opt.interfere && c.helper !== me) return false;
  const can = me.hand.some((x) => x.kind === 'enh' || (x.kind === 'oneshot' && x.b > 0) || x.kind === 'curse'
    || (x.kind === 'wander' && me.hand.some((y) => y.kind === 'monster')))
    || (hasCls(me, 'thief') && me.hand.length && !c.backstab.has(me.id));
  if (!can) return false;
  const before = sideStr(c) - monStr(c);
  const handBefore = me.hand.length;
  G.phase = 'interfere';
  await waitFor(['done']);
  G.phase = 'wait';
  return me.hand.length !== handBefore || sideStr(c) - monStr(c) !== before;
}

/* ---------------- новая партия ---------------- */

function newGame(opt) {
  uid = 0;
  T = SETS[opt.theme];
  document.body.dataset.theme = opt.theme;
  const decks = buildDecks(opt.theme, opt.exps);
  G = { opt, door: decks.door, tre: decks.tre, doorD: [], treD: [], players: [], turn: 0, round: 1,
    phase: 'wait', awaiting: [], resolver: null, combat: null, reveal: null, winner: null, flags: {}, cur: null,
    aggr: { kind: 0.6, normal: 1, evil: 1.5 }[opt.anger] || 1, logs: [] };
  G.me = mkPlayer(opt.name || 'Вы', opt.sex, true, T.you[opt.sex]);
  G.players.push(G.me);
  T.bots.slice(0, opt.bots).forEach(([n, s, a]) => G.players.push(mkPlayer(n, s, false, a)));
  G.players.forEach((p) => {
    for (let i = 0; i < 4; i++) p.hand.push(draw('door'));
    for (let i = 0; i < 4; i++) p.hand.push(draw('tre'));
  });
  G.players.filter((p) => !p.human).forEach(botManage);
  clearLog();
  log(`Новая партия: ${T.title}. Дойдите до 10 уровня — последний уровень только за убийство монстра!`, 'sys');
  render();
  loop();
}
