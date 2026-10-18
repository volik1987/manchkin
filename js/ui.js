/*
 * Отрисовка стола, карт, диалогов и обработка тапов.
 */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const KIND_LBL = { monster: 'Монстр', enh: 'Усилитель', curse: 'Проклятие', race: 'Раса', class: 'Класс', item: 'Шмотка',
  oneshot: 'Разовая', levelup: 'Уровень', steed: 'Скакун', ally: 'Подручный', wander: 'Особая', super: 'Особая', half: 'Особая' };

/* ---------------- журнал и всплывашки ---------------- */

function log(text, cls = '') {
  if (!G) return;
  G.logs.push({ text, cls });
  const el = document.createElement('div');
  el.className = 'lg ' + cls;
  el.textContent = text;
  const box = $('#log');
  box.appendChild(el);
  while (box.children.length > 300) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
  $('#lastlog').textContent = text;
  $('#lastlog').className = 'lastlog ' + cls;
}
function clearLog() { $('#log').innerHTML = ''; }

function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

/* ---------------- карты ---------------- */

function cardInfo(c, owner) {
  let stat = '', txt = '', foot = '';
  switch (c.kind) {
    case 'monster': {
      stat = 'Ур. ' + c.lvl;
      const tags = [];
      if (c.u) tags.push('Нежить');
      (c.vs || []).forEach((v) => {
        const who = v.race ? T.races[v.race][0] : v.cls ? T.classes[v.cls][0] : v.sex === 'f' ? 'дам' : 'мужчин';
        tags.push(`${sign(v.m)} против: ${who}`);
      });
      if (c.run) tags.push(`${sign(c.run)} к смывке`);
      if (c.noPursue) tags.push(`Не гонится за ур. ≤${c.noPursue}`);
      txt = (tags.length ? `<i>${tags.join('. ')}.</i> ` : '') + '<b>Непотребство:</b> ' + esc(c.badText);
      foot = `${c.t} сокр.` + (c.lv > 1 ? ' · 2 ур.' : '');
      break;
    }
    case 'enh': stat = sign(c.m); txt = `${sign(c.m)} к монстру, ${sign(c.t)} сокр. Играй на любой бой.`; break;
    case 'curse': txt = esc(c.text) + ' Играй на любого игрока.'; break;
    case 'race': case 'class': txt = esc(T.abil[c.key]); break;
    case 'super': txt = 'Можно иметь два класса сразу.'; break;
    case 'half': txt = 'Можно иметь две расы сразу.'; break;
    case 'item': {
      stat = c.b ? '+' + c.b : '';
      const r = [SLOT_NAMES[c.slot]];
      if (c.big) r.push('<b>Большая</b>');
      if (c.run) r.push(`${sign(c.run)} к смывке`);
      const req = reqText(c); if (req) r.push(`<i>${req}</i>`);
      txt = r.join('. ') + '.';
      foot = c.v + ' зол.';
      break;
    }
    case 'oneshot':
      stat = c.b ? '+' + c.b : '';
      txt = c.eff === 'escape' ? 'Используй в своём бою: автоматически смойся.'
        : c.eff === 'friend' ? 'Используй в своём бою: монстры уходят без боя, сокровищ нет.'
        : `Разовая: ${sign(c.b)} любой стороне в бою.` + (c.bu ? ` <b>+${c.bu} против нежити.</b>` : '');
      foot = c.v + ' зол.';
      break;
    case 'levelup': stat = '+1 ур.'; txt = 'Получи уровень. Кроме победного!'; break;
    case 'steed': stat = sign(c.b); txt = `Скакун. ${c.run ? sign(c.run) + ' к смывке. ' : ''}Только один.`; foot = c.v + ' зол.'; break;
    case 'ally': stat = sign(c.b); txt = `Подручный. ${c.run ? sign(c.run) + ' к смывке. ' : ''}Можно пожертвовать им, чтобы смыться.`; break;
    case 'wander': txt = 'Играй вместе с монстром с руки: он вступает в чужой бой.'; break;
  }
  const off = owner && (c.kind === 'item') && !reqOk(owner, c);
  return { stat, txt, foot, off };
}

function cardHTML(c, opts = {}) {
  const { stat, txt, foot, off } = cardInfo(c, opts.owner);
  const z = opts.zone ? ` data-zone="${opts.zone}"` : '';
  return `<div class="card k-${c.kind}${off ? ' off' : ''}${opts.cls ? ' ' + opts.cls : ''}" data-uid="${c.uid}"${z}>
    <div class="ctop"><span class="ck">${KIND_LBL[c.kind]}</span>${stat ? `<span class="cst">${stat}</span>` : ''}</div>
    <div class="ce">${c.e}</div>
    <div class="cn">${esc(c.name)}</div>
    <div class="ct">${txt}</div>
    ${foot ? `<div class="cf">${foot}</div>` : ''}
  </div>`;
}

function chipHTML(c, zone, owner) {
  const off = c.kind === 'item' && !reqOk(owner, c);
  const b = c.b ? sign(c.b) : c.run ? '🏃' + sign(c.run) : '';
  return `<button class="chip${off ? ' off' : ''}" data-uid="${c.uid}" data-zone="${zone}"><span>${c.e}</span><b>${b}</b></button>`;
}

/* ---------------- рендер стола ---------------- */

function render() {
  if (!G) return;
  renderTop(); renderOpps(); renderArena(); renderMe(); renderActions(); renderHand();
}

function renderTop() {
  $('#piles').innerHTML = `<span title="Двери">🚪${G.door.length}</span><span title="Сокровища">💰${G.tre.length}</span><span title="Раунд">⏳${G.round}</span>`;
}

function renderOpps() {
  $('#opps').innerHTML = G.players.filter((p) => !p.human).map((p) => `
    <button class="opp${G.cur === p ? ' cur' : ''}" data-opp="${p.id}">
      <div class="oav">${p.av}</div>
      <div class="oinfo"><div class="oname">${esc(p.name)}</div>
      <div class="osub">${esc(raceStr(p))} · ${esc(clsStr(p))}</div>
      <div class="ostat"><span class="lvl">${p.level}</span><span>💪${power(p)}</span><span>🂠${p.hand.length}</span></div></div>
    </button>`).join('');
}

function renderArena() {
  const a = $('#arena');
  const c = G.combat;
  if (c) {
    const win = winning(c);
    const side = sideStr(c), mon = monStr(c);
    const monsHTML = c.mons.map((m) => `<div class="mstack">${cardHTML(m.card, { zone: 'view' })}
      ${m.enh.map((e) => `<div class="enhtag" data-uid="${e.uid}" data-zone="view">${e.e} ${esc(e.name)} ${sign(e.m)}</div>`).join('')}</div>`).join('');
    const parts = [`${power(c.fighter)} ${esc(c.fighter.name)}`];
    if (c.fighter.weak) parts.push(`−${c.fighter.weak} штраф`);
    if (c.helper) parts.push(`${power(c.helper)} ${esc(c.helper.name)}`);
    if (c.pB) parts.push(`${sign(c.pB)} карты`);
    const mparts = [];
    if (c.mB) mparts.push(`${sign(c.mB)} карты`);
    a.innerHTML = `<div class="combat">
      <div class="mons">${monsHTML}</div>
      <div class="versus ${win ? 'win' : 'lose'}">
        <div class="vside"><div class="vnum">${side}</div><div class="vlbl">${parts.join(' + ')}</div></div>
        <div class="vmid">${win ? 'побеждает' : 'проигрывает'}<br><small>${c.fighter.human ? 'вы' : esc(c.fighter.name)}</small></div>
        <div class="vside"><div class="vnum">${mon}</div><div class="vlbl">монстр${mparts.length ? ' ' + mparts.join(' ') : ''} · 💰${treasureCount(c)}</div></div>
      </div></div>`;
    return;
  }
  const r = G.reveal;
  if (r) {
    a.innerHTML = `<div class="reveal">${r.card ? cardHTML(r.card, { zone: 'view', cls: 'big' }) : '<div class="cardback">🚪</div>'}
      <div class="rnote">${esc(r.note || '')}</div></div>`;
  } else {
    a.innerHTML = `<div class="reveal"><div class="cardback">🚪</div><div class="rnote">Дверь ждёт пинка</div></div>`;
  }
}

function slotHTML(p, slot, label) {
  const items = p.eq.filter((c) => c.slot === slot);
  return `<div class="slot"><div class="slbl">${label}</div><div class="sitems">${items.length ? items.map((c) => chipHTML(c, 'eq', p)).join('') : '<span class="empty">—</span>'}</div></div>`;
}

function renderMe() {
  const p = G.me;
  const exps = G.opt.exps;
  const hands = p.eq.filter((c) => c.slot === 'hand' || c.slot === 'hands2');
  const rc = [...p.races.map((c) => chipHTML(c, 'race', p)), ...p.classes.map((c) => chipHTML(c, 'class', p)), ...p.extras.map((c) => chipHTML(c, 'extra', p))];
  $('#me').innerHTML = `
    <div class="mehead${G.cur === p ? ' cur' : ''}">
      <div class="meav">${p.av}</div>
      <div class="mename"><b>${esc(p.name)}</b><small>${esc(raceStr(p))} · ${esc(clsStr(p))}</small></div>
      <div class="mestats">
        <div class="bigstat"><span>${p.level}</span><small>уровень</small></div>
        <div class="bigstat"><span>${power(p)}</span><small>сила</small></div>
        <div class="bigstat"><span>${sign(runB(p))}</span><small>смывка</small></div>
      </div>
    </div>
    ${p.weak ? `<div class="weak">Штраф в следующем бою: −${p.weak}</div>` : ''}
    <div class="gear">
      ${rc.length ? `<div class="slot"><div class="slbl">Кто я</div><div class="sitems">${rc.join('')}</div></div>` : ''}
      ${slotHTML(p, 'head', 'Голова')}${slotHTML(p, 'armor', 'Тело')}${slotHTML(p, 'feet', 'Ноги')}
      <div class="slot"><div class="slbl">Руки</div><div class="sitems">${hands.length ? hands.map((c) => chipHTML(c, 'eq', p)).join('') : '<span class="empty">—</span>'}</div></div>
      ${p.eq.some((c) => c.slot === 'none') ? slotHTML(p, 'none', 'Прочее') : ''}
      ${exps.includes('steeds') ? `<div class="slot"><div class="slbl">Скакун</div><div class="sitems">${p.steed ? chipHTML(p.steed, 'steed', p) : '<span class="empty">—</span>'}</div></div>` : ''}
      ${exps.includes('allies') ? `<div class="slot"><div class="slbl">Подручный</div><div class="sitems">${p.ally ? chipHTML(p.ally, 'ally', p) : '<span class="empty">—</span>'}</div></div>` : ''}
      ${p.bag.length ? `<div class="slot"><div class="slbl">Сумка</div><div class="sitems">${p.bag.map((c) => chipHTML(c, 'bag', p)).join('')}</div></div>` : ''}
    </div>`;
}

const myFree = () => G.cur === G.me && ['prep', 'after', 'end'].includes(G.phase) && !G.combat;

function renderActions() {
  const p = G.me, ph = G.phase, c = G.combat;
  const B = (act_, label, cls = '', dis = false) => `<button class="btn ${cls}" data-act="${act_}"${dis ? ' disabled' : ''}>${label}</button>`;
  let h = '', hint = '';
  const sell = B('sell', '💰 Продать', 'ghost');
  if (ph === 'prep') { hint = 'Ваш ход. Наденьте шмотки, сыграйте расу и класс — и вперёд.'; h = B('kick', '🚪 Вышибить дверь', 'main') + sell; }
  else if (ph === 'after') {
    hint = 'Монстра нет. Подраться со своим монстром или взять карту взакрытую?';
    h = B('trouble', '😈 Искать неприятности', 'main', !p.hand.some((x) => x.kind === 'monster')) + B('loot', '🔍 Чистить нычки', 'main') + sell;
  } else if (ph === 'combat' && c) {
    hint = winning(c) ? 'Вы сильнее! Бейте — но соперники могут вмешаться.' : 'Монстр сильнее. Сыграйте карты, позовите помощь или смывайтесь.';
    h = B('fight', '⚔️ Бьёмся!', 'main', !winning(c)) + B('help', '🤝 Помощь', '', !!c.helper) + B('run', '🏃 Смываться', 'warn');
    if (hasCls(p, 'warrior') && c.berserk < 3) h += B('berserk', `${T.btn.berserk} +1 (${c.berserk}/3)`, 'ab', !p.hand.length);
    if (hasCls(p, 'cleric') && hasUndead(c) && c.turned < 3) h += B('turnund', `${T.btn.turn} +3 (${c.turned}/3)`, 'ab', !p.hand.length);
    if (hasCls(p, 'wizard') && c.flight < 3) h += B('flight', `${T.btn.flight} 🏃+1 (${c.flight}/3)`, 'ab', !p.hand.length);
    if (hasCls(p, 'wizard') && c.mons.length === 1) h += B('charm', `${T.btn.charm}`, 'ab', p.hand.length < 3);
    if (p.ally) h += B('sacrifice', 'Пожертвовать подручным', 'ab');
  } else if (ph === 'end') { hint = 'Можно продать шмотки или проклясть соперника.'; h = B('end', '✅ Завершить ход', 'main') + sell; }
  else if (ph === 'charity') {
    const over = p.hand.length - handLimit(p);
    hint = over > 0 ? `Благотворительность: на руке больше ${handLimit(p)}. Тапните карту, чтобы отдать (ещё ${over}).` : 'Готово!';
    h = B('charityDone', 'Готово', 'main', over > 0);
  } else if (ph === 'interfere' && c) {
    hint = c.helper === p ? `Вы помогаете ${c.fighter.name}. Можно сыграть карты за бойца.` : `${c.fighter.name} побеждает. Подкиньте монстру гадость с руки — или пропустите.`;
    h = B('done', c.helper === p ? 'Готово' : 'Не вмешиваться', 'main');
    if (hasCls(p, 'thief') && !c.backstab.has(p.id) && c.helper !== p) h += B('backstab', `${T.btn.backstab} −2`, 'ab', !p.hand.length);
  } else {
    hint = G.cur && !G.cur.human ? `Ходит ${G.cur.name}…` : '';
  }
  $('#hint').textContent = hint;
  $('#actions').innerHTML = h;
}

function renderHand() {
  const p = G.me;
  const over = p.hand.length > handLimit(p) && G.cur === p && ['end', 'charity'].includes(G.phase);
  $('#handlbl').innerHTML = `Рука: ${p.hand.length}/${handLimit(p)}${over ? ' <b class="warnc">перебор</b>' : ''}`;
  const order = { monster: 0, enh: 1, wander: 2, curse: 3, race: 4, class: 5, super: 6, half: 7, ally: 8, levelup: 9, oneshot: 10, item: 11, steed: 12 };
  const cards = p.hand.slice().sort((a, b) => order[a.kind] - order[b.kind]);
  $('#hand').innerHTML = cards.length ? cards.map((c) => cardHTML(c, { zone: 'hand', owner: p, cls: playable(c) ? 'can' : '' })).join('')
    : '<div class="empty">Рука пуста</div>';
}

function playable(c) { return cardActions(c, 'hand').some((a) => !a.danger && !a.dis); }

/* ---------------- действия с картами ---------------- */

function findCard(uidv) {
  const id = +uidv;
  const all = [];
  G.players.forEach((p) => {
    all.push(...p.hand, ...p.eq, ...p.bag, ...p.races, ...p.classes, ...p.extras);
    if (p.steed) all.push(p.steed); if (p.ally) all.push(p.ally);
  });
  if (G.combat) G.combat.mons.forEach((m) => all.push(m.card, ...m.enh));
  if (G.reveal && G.reveal.card) all.push(G.reveal.card);
  return all.find((c) => c.uid === id);
}

function cardActions(c, zone) {
  const p = G.me, ph = G.phase, cb = G.combat;
  const free = myFree();
  const out = [];
  const add = (l, f, extra = {}) => out.push({ l, f, ...extra });
  if (zone === 'hand') {
    if (ph === 'charity') {
      const minL = Math.min(...others(p).map((x) => x.level));
      add(p.level <= minL ? 'Сбросить' : 'Отдать слабейшему', () => charityGive(p, c));
      return out;
    }
    const ownFight = cb && ph === 'combat' && cb.fighter === p;
    const interf = cb && ph === 'interfere';
    switch (c.kind) {
      case 'item':
        if (free) {
          const pr = equipProblem(p, c, false);
          add('Надеть', () => { equip(p, c, false); log(`${p.name} надевает «${c.name}».`); }, { dis: pr, why: pr });
          const bigPr = c.big && !canCarryBig(p) ? 'Уже есть Большая шмотка' : null;
          add('Положить в сумку', () => { takeFromHand(p, c); p.bag.push(c); }, { dis: bigPr, why: bigPr });
        }
        break;
      case 'steed': case 'ally':
        if (free) add(c.kind === 'steed' ? 'Оседлать' : 'Нанять', () => playSteedAlly(p, c), { confirm: p[c.kind] ? `Заменить «${p[c.kind].name}»?` : null });
        break;
      case 'race': case 'class': case 'super': case 'half': {
        if (!free) break;
        const list = c.kind === 'race' ? p.races : p.classes;
        const max = c.kind === 'race' ? maxRaces(p) : maxClasses(p);
        const dup = (c.kind === 'race' && hasRace(p, c.key)) || (c.kind === 'class' && hasCls(p, c.key))
          || ((c.kind === 'super' || c.kind === 'half') && p.extras.some((x) => x.kind === c.kind));
        add('Сыграть', () => playRaceClass(p, c), { dis: dup ? 'Уже есть' : null, why: dup ? 'Уже есть' : null,
          confirm: (c.kind === 'race' || c.kind === 'class') && list.length >= max ? `Заменить «${list[0].name}»?` : null });
        break;
      }
      case 'levelup':
        if (free) add('Получить уровень', () => playLevelUp(p, c), { dis: p.level >= 9, why: p.level >= 9 ? 'Победный уровень так не взять' : null });
        break;
      case 'curse':
        if (free || interf) others(p).forEach((t) => add(`Проклясть: ${t.name}`, () => castCurse(p, t, c)));
        break;
      case 'oneshot':
        if (ownFight) {
          if (c.eff) add(c.eff === 'escape' ? 'Использовать: смыться' : 'Использовать: мир', () => { takeFromHand(p, c); discard(c); cb.end = c.eff; act('potion'); });
          else add(`За себя (${sign(shotVal(c, cb))})`, () => useShot(p, c, 'side', cb));
        }
        if (interf && c.b) {
          if (cb.helper === p) add(`За бойца (${sign(shotVal(c, cb))})`, () => useShot(p, c, 'side', cb));
          else add(`За монстра (${sign(c.b)})`, () => useShot(p, c, 'mon', cb));
        }
        break;
      case 'enh':
        if (ownFight || interf) cb.mons.forEach((m, i) => add(`На «${m.card.name}» (${sign(c.m)})`, () => useEnh(p, c, cb, i)));
        break;
      case 'wander':
        if (interf && cb.helper !== p) {
          const ms = p.hand.filter((x) => x.kind === 'monster');
          add('Подкинуть монстра', async () => {
            const m = await pickCard(ms, 'Кого подкинуть в бой?');
            if (m) { useWander(p, c, m, cb); render(); }
          }, { dis: !ms.length, why: !ms.length ? 'Нет монстра на руке' : null });
        }
        break;
    }
    if (free) add('Сбросить', () => { takeFromHand(p, c); discard(c); log(`${p.name} сбрасывает «${c.name}».`); }, { danger: true, confirm: 'Сбросить карту?' });
  }
  if (!free) return out;
  if (zone === 'eq') add('Снять в сумку', () => { p.eq.splice(p.eq.indexOf(c), 1); p.bag.push(c); });
  if (zone === 'bag') {
    const pr = equipProblem(p, c, true);
    add('Надеть', () => equip(p, c, true), { dis: pr, why: pr });
    add('Сбросить', () => { p.bag.splice(p.bag.indexOf(c), 1); discard(c); }, { danger: true, confirm: 'Сбросить шмотку?' });
  }
  if (zone === 'steed' || zone === 'ally') add('Отпустить', () => { discard(p[zone]); p[zone] = null; }, { danger: true, confirm: 'Точно?' });
  return out;
}

async function openCardMenu(c, zone) {
  const acts = zone === 'view' ? [] : cardActions(c, zone);
  const html = `<div class="cmenu">${cardHTML(c, { cls: 'big', owner: G.me })}
    <div class="cacts">${acts.map((a, i) => `<button class="btn ${a.danger ? 'warn' : 'main'}" data-pick="${i}"${a.dis ? ' disabled' : ''}>${esc(a.l)}${a.why ? `<small>${esc(a.why)}</small>` : ''}</button>`).join('')}
    ${!acts.length && zone === 'hand' ? `<div class="muted">${G.cur === G.me ? 'Сейчас эту карту не сыграть.' : 'Дождитесь своего хода.'}</div>` : ''}
    <button class="btn ghost" data-pick="x">Закрыть</button></div></div>`;
  const r = await modal({ html, cls: 'menu' });
  if (r == null || r === 'x') return;
  const a = acts[+r];
  if (!a || a.dis) return;
  if (a.confirm) { const ok = await confirmBox(a.confirm); if (!ok) return; }
  await a.f();
  render();
}

/* ---------------- модальные окна ---------------- */

let modalDepth = 0;
function modal({ title = '', html = '', buttons = [], cls = '', dismiss = true }) {
  return new Promise((res) => {
    const ov = document.createElement('div');
    ov.className = 'ov';
    ov.innerHTML = `<div class="mdl ${cls}">${title ? `<h3>${title}</h3>` : ''}<div class="mb">${html}</div>
      ${buttons.length ? `<div class="mbtns">${buttons.map((b) => `<button class="btn ${b.cls || ''}" data-pick="${b.v}">${b.l}</button>`).join('')}</div>` : ''}</div>`;
    const done = (v) => { ov.remove(); modalDepth--; res(v); };
    ov.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pick]');
      if (t && !t.disabled) { done(t.dataset.pick); return; }
      if (e.target === ov && dismiss) done(null);
    });
    modalDepth++;
    $('#modals').appendChild(ov);
    if (modal.onOpen) { const f = modal.onOpen; modal.onOpen = null; f(ov); }
  });
}
const confirmBox = (q) => modal({ html: `<p>${esc(q)}</p>`, buttons: [{ l: 'Да', v: 'y', cls: 'main' }, { l: 'Нет', v: 'n', cls: 'ghost' }] }).then((v) => v === 'y');

async function pickCard(cards, title, sub = '') {
  if (!cards.length) return null;
  const html = `${sub ? `<p class="muted">${esc(sub)}</p>` : ''}<div class="pickgrid">${cards.map((c) => `<div data-pick="${c.uid}">${cardHTML(c)}</div>`).join('')}</div>`;
  const r = await modal({ title, html, buttons: [{ l: 'Отмена', v: 'x', cls: 'ghost' }] });
  if (r == null || r === 'x') return null;
  return cards.find((c) => c.uid === +r) || null;
}

function showCards(cards, title, btn = 'Отлично') {
  return modal({ title, html: `<div class="pickgrid">${cards.map((c) => cardHTML(c, { owner: G.me })).join('')}</div>`, buttons: [{ l: btn, v: 'ok', cls: 'main' }] });
}

const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
async function showDice(roll, bonus, ok, mon, f) {
  if (!f.human) { toast(`🎲 ${f.name}: ${roll}${bonus ? sign(bonus) : ''} — ${ok ? 'смылся' : 'пойман'}`, ok ? '' : 'bad'); await sleep(900); return; }
  const html = `<div class="dice"><div class="die rolling" id="die">⚀</div>
    <div class="dres" id="dres">&nbsp;</div><p class="muted">Нужно 5+ (бонус ${sign(bonus)})</p></div>`;
  modal.onOpen = (ov) => {
    const die = ov.querySelector('#die'); let n = 0;
    const btn = ov.querySelector('[data-pick]'); btn.disabled = true;
    const iv = setInterval(() => {
      die.textContent = DICE[rnd(6)];
      if (++n > 10) {
        clearInterval(iv); die.textContent = DICE[roll - 1]; die.classList.remove('rolling');
        ov.querySelector('#dres').innerHTML = ok ? `<b class="goodc">${roll}${bonus ? ' ' + sign(bonus) : ''} — смылись!</b>` : `<b class="warnc">${roll}${bonus ? ' ' + sign(bonus) : ''} — поймали!</b><br><small>${esc(mon.badText)}</small>`;
        btn.disabled = false;
      }
    }, 70);
  };
  await modal({ title: `Смывка от: ${mon.name}`, html, buttons: [{ l: 'Дальше', v: 'ok', cls: 'main' }], dismiss: false });
}

async function askHelpDialog(c, bots) {
  const tc = treasureCount(c);
  const need = needToWin(c);
  const html = `<p>Не хватает силы: <b>${need}</b>. Сокровищ в бою: <b>${tc}</b>.</p>
    <label class="row">Отдать помощнику: <select id="offer">${Array.from({ length: tc + 1 }, (_, i) => `<option value="${i}"${i === Math.min(tc, Math.ceil(tc / 2)) ? ' selected' : ''}>${i}</option>`).join('')}</select> сокр.</label>
    <div class="helplist">${bots.map((b) => `<button class="btn ${power(b) >= need ? 'main' : 'ghost'}" data-pick="${b.id}">${b.av} ${esc(b.name)} — сила ${power(b)}${hasRace(b, 'elf') ? ' 🌟' : ''}</button>`).join('')}</div>
    <p class="muted">Соперники неохотно помогают лидеру и никогда — если бой принесёт вам победу.</p>`;
  let offer = 0;
  modal.onOpen = (ov) => { const s = ov.querySelector('#offer'); offer = +s.value; s.addEventListener('change', () => { offer = +s.value; }); s.addEventListener('click', (e) => e.stopPropagation()); };
  const r = await modal({ title: 'Позвать на помощь', html, buttons: [{ l: 'Отмена', v: 'x', cls: 'ghost' }] });
  if (r == null || r === 'x') return null;
  return { bot: G.players[+r], offer };
}

async function helpRequestDialog(f, c, offer) {
  const html = `<div class="pickgrid">${c.mons.map((m) => cardHTML(m.card)).join('')}</div>
    <p><b>${esc(f.name)}</b> (сила ${sideStr(c)}) против монстра (${monStr(c)}). Предлагает <b>${offer}</b> сокр. из ${treasureCount(c)}.${hasRace(G.me, 'elf') ? ' Вы получите уровень за помощь!' : ''}</p>`;
  const r = await modal({ title: `${f.name} просит помощи`, html, dismiss: false,
    buttons: [{ l: '🤝 Помочь', v: 'y', cls: 'main' }, { l: 'Отказать', v: 'n', cls: 'ghost' }] });
  return r === 'y';
}

async function openSale() {
  if (!myFree()) return;
  const p = G.me;
  const items = [...p.hand.filter((x) => x.v), ...p.bag, ...p.eq, ...(p.steed ? [p.steed] : [])];
  if (!items.length) { toast('Продавать нечего.'); return; }
  const where = (c) => (p.hand.includes(c) ? 'рука' : p.bag.includes(c) ? 'сумка' : 'надето');
  const html = `<p class="muted">1000 золотых = 1 уровень. Сдачи нет, победный уровень так не купить.${hasRace(p, 'halfling') && !G.flags.halfDouble ? ' Самая дорогая шмотка продаётся вдвое!' : ''}</p>
    <div class="sale">${items.map((c) => `<label class="srow"><input type="checkbox" value="${c.uid}"><span>${c.e} ${esc(c.name)} <small>(${where(c)})</small></span><b>${c.v}</b></label>`).join('')}</div>
    <div class="stotal" id="stotal">Выбрано: 0 зол.</div>`;
  let chosen = [];
  modal.onOpen = (ov) => {
    const upd = () => {
      chosen = [...ov.querySelectorAll('input:checked')].map((i) => items.find((c) => c.uid === +i.value));
      const t = sellValue(p, chosen);
      const lv = Math.min(Math.floor(t / 1000), 9 - p.level);
      ov.querySelector('#stotal').innerHTML = `Выбрано: <b>${t}</b> зол. → <b>+${Math.max(0, lv)}</b> ур.`;
      ov.querySelector('[data-pick="sell"]').disabled = lv <= 0;
    };
    ov.querySelectorAll('input').forEach((i) => i.addEventListener('change', upd));
    upd();
  };
  const r = await modal({ title: 'Продать шмотки', html, buttons: [{ l: 'Продать', v: 'sell', cls: 'main' }, { l: 'Отмена', v: 'x', cls: 'ghost' }] });
  if (r === 'sell' && chosen.length) { sellItems(p, chosen); render(); }
}

function showOpp(p) {
  const all = [...p.races, ...p.classes, ...p.extras, ...p.eq, ...(p.steed ? [p.steed] : []), ...(p.ally ? [p.ally] : [])];
  const html = `<p>${p.av} <b>${esc(p.name)}</b> · уровень ${p.level} · сила ${power(p)} · смывка ${sign(runB(p))} · карт на руке: ${p.hand.length}${p.bag.length ? ` · в сумке: ${p.bag.length}` : ''}</p>
    ${all.length ? `<div class="pickgrid">${all.map((c) => cardHTML(c, { owner: p })).join('')}</div>` : '<p class="muted">Ничего у него нет. Пока.</p>'}`;
  modal({ title: 'Соперник', html, buttons: [{ l: 'Закрыть', v: 'x', cls: 'ghost' }] });
}

function showWinner() {
  const w = G.winner, me = w === G.me;
  const html = `<div class="winner"><div class="wav">${w.av}</div>
    <h2>${me ? 'Победа!' : 'Поражение'}</h2>
    <p>${me ? `Вы дошли до 10 уровня за ${G.round} раунд(ов). Настоящий манчкин!` : `${esc(w.name)} первым дошёл до 10 уровня. Реванш?`}</p></div>`;
  modal({ html, dismiss: false, buttons: [{ l: 'Новая игра', v: 'new', cls: 'main' }] }).then(() => openSetup());
}

/* ---------------- стартовый экран и правила ---------------- */

const SETUP_KEY = 'manchkin-setup';
function loadSetup() {
  try { return JSON.parse(localStorage.getItem(SETUP_KEY)) || null; } catch (e) { return null; }
}
function saveSetup(o) { try { localStorage.setItem(SETUP_KEY, JSON.stringify(o)); } catch (e) { /* без памяти — не беда */ } }

function openSetup() {
  const s = loadSetup() || { theme: 'russian', exps: ['steeds', 'allies', 'dark', 'double'], bots: 3, name: '', sex: 'm', anger: 'normal', interfere: true, speed: 1 };
  const expHTML = (th) => EXP_KEYS.map((k) => {
    const e = SETS[th].exp[k];
    return `<label class="exp"><input type="checkbox" name="exp" value="${k}"${s.exps.includes(k) ? ' checked' : ''}><span class="expe">${e.e}</span><span><b>${e.name}</b><small>${e.desc}</small></span></label>`;
  }).join('');
  const html = `
    <div class="setup">
      <div class="logo">Манчкин<small>на одного</small></div>
      <div class="themes">
        ${['russian', 'classic'].map((th) => `<label class="theme t-${th}"><input type="radio" name="theme" value="${th}"${s.theme === th ? ' checked' : ''}>
          <span class="the">${th === 'russian' ? '🐉' : '🧝'}</span><b>${SETS[th].title}</b><small>${SETS[th].sub}</small></label>`).join('')}
      </div>
      <h4>Дополнения</h4><div id="exps">${expHTML(s.theme)}</div>
      <h4>Герой</h4>
      <div class="row2"><input id="sname" maxlength="16" placeholder="Ваше имя" value="${esc(s.name)}">
        <div class="seg"><label><input type="radio" name="sex" value="m"${s.sex === 'm' ? ' checked' : ''}><span>♂ Муж.</span></label><label><input type="radio" name="sex" value="f"${s.sex === 'f' ? ' checked' : ''}><span>♀ Жен.</span></label></div></div>
      <h4>Соперники</h4>
      <div class="seg wide">${[1, 2, 3].map((n) => `<label><input type="radio" name="bots" value="${n}"${s.bots === n ? ' checked' : ''}><span>${n} бот${n === 1 ? '' : 'а'}</span></label>`).join('')}</div>
      <div class="seg wide">${[['kind', '😇 Мирные'], ['normal', '😏 Обычные'], ['evil', '😈 Подлые']].map(([v, l]) => `<label><input type="radio" name="anger" value="${v}"${s.anger === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="seg wide">${[[1.6, '🐢 Медленно'], [1, '▶ Обычно'], [0.5, '⏩ Быстро']].map(([v, l]) => `<label><input type="radio" name="speed" value="${v}"${+s.speed === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <label class="exp"><input type="checkbox" id="sinterf"${s.interfere ? ' checked' : ''}><span class="expe">🖐️</span><span><b>Вмешиваться в бои ботов</b><small>Игра будет останавливаться, когда вы можете подгадить сопернику.</small></span></label>
    </div>`;
  modal.onOpen = (ov) => {
    ov.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => {
      const cur = [...ov.querySelectorAll('input[name=exp]:checked')].map((i) => i.value);
      s.exps = cur; ov.querySelector('#exps').innerHTML = expHTML(r.value);
    }));
  };
  modal({ html, cls: 'setupm', dismiss: false, buttons: [{ l: '⚔️ Начать игру', v: 'go', cls: 'main big' }, { l: '📖 Правила', v: 'rules', cls: 'ghost' }] });
  // считываем значения до закрытия: перехватываем клик по кнопке
  const ovEl = $('#modals').lastElementChild;
  ovEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick]');
    if (!t) return;
    const val = (n) => (ovEl.querySelector(`input[name=${n}]:checked`) || {}).value;
    const o = {
      theme: val('theme'), exps: [...ovEl.querySelectorAll('input[name=exp]:checked')].map((i) => i.value),
      bots: +val('bots'), name: ovEl.querySelector('#sname').value.trim(), sex: val('sex'), anger: val('anger'),
      speed: +val('speed'), interfere: ovEl.querySelector('#sinterf').checked,
    };
    saveSetup(o);
    if (t.dataset.pick === 'rules') setTimeout(() => showRules().then(openSetup), 0);
    else { SPEED = o.speed; setTimeout(() => newGame(o), 0); }
  }, true);
}

function showRules() {
  const html = `<div class="rules">
    <p><b>Цель:</b> первым дойти до <b>10 уровня</b>. Последний уровень — только за победу над монстром.</p>
    <p><b>Ход:</b> 1) готовьтесь: надевайте шмотки, играйте расу и класс; 2) <b>вышибите дверь</b> — откройте карту двери. Монстр — бой. Проклятие — срабатывает на вас. Иное — на руку. 3) Если монстра не было: <b>ищите неприятности</b> (дерётесь со своим монстром с руки) или <b>чистите нычки</b> (берёте дверь взакрытую). 4) <b>Благотворительность:</b> больше 5 карт на руке — лишние отдаёте самому слабому сопернику.</p>
    <p><b>Бой:</b> ваша сила = уровень + бонусы шмоток. Нужно быть <b>строго сильнее</b> монстра (Воин/Богатырь побеждает при ничьей). Победа — уровень (у больших монстров два) и сокровища. Можно сыграть разовые шмотки, усилители, позвать соперника на помощь за долю сокровищ.</p>
    <p><b>Соперники вмешиваются!</b> Когда вы побеждаете, боты могут подкинуть монстру усилитель, зелье или бродячую тварь. И вы можете делать с ними то же самое.</p>
    <p><b>Смывка:</b> бросок кубика, нужно 5+ (с бонусами). Не вышло — получаете непотребство монстра. Смерть: теряете шмотки и руку, но сохраняете уровень, расу и класс.</p>
    <p><b>Шмотки:</b> один головняк, один броник, одна обувка, две руки. Только одна <b>Большая</b> шмотка (кроме Дварфа/Домового). 1000 золотых продажей = 1 уровень.</p>
    <p><b>Дополнения:</b> скакуны (+сила и смывка), подручные (можно пожертвовать, чтобы сбежать), больше монстров и проклятий, двойные расы и классы.</p>
    <p class="muted">Тапните любую карту, чтобы прочитать её целиком и увидеть, что с ней можно сделать. Фанатская игра по мотивам настольного «Манчкина» Стива Джексона.</p>
  </div>`;
  return modal({ title: 'Правила', html, buttons: [{ l: 'Понятно', v: 'ok', cls: 'main' }] });
}

/* ---------------- обработка тапов ---------------- */

document.addEventListener('click', async (e) => {
  if (!G || modalDepth) return;
  const actBtn = e.target.closest('[data-act]');
  if (actBtn && !actBtn.disabled) { await onAction(actBtn.dataset.act); return; }
  const opp = e.target.closest('[data-opp]');
  if (opp) { showOpp(G.players[+opp.dataset.opp]); return; }
  const cardEl = e.target.closest('[data-uid][data-zone]');
  if (cardEl) {
    const c = findCard(cardEl.dataset.uid);
    if (c) await openCardMenu(c, cardEl.dataset.zone);
  }
});

async function discardForAbility(title) {
  const c = await pickCard(G.me.hand, title, 'Какую карту сбросить?');
  if (!c) return false;
  takeFromHand(G.me, c); discard(c);
  return true;
}

async function onAction(a) {
  const p = G.me, c = G.combat;
  switch (a) {
    case 'sell': await openSale(); return;
    case 'berserk': if (await discardForAbility(T.btn.berserk)) { c.berserk++; c.pB++; log(`${p.name}: ${T.btn.berserk} (+1).`, 'good'); } break;
    case 'turnund': if (await discardForAbility(T.btn.turn)) { c.turned++; c.pB += 3; log(`${p.name}: ${T.btn.turn} (+3).`, 'good'); } break;
    case 'flight': if (await discardForAbility(T.btn.flight)) { c.flight++; log(`${p.name}: ${T.btn.flight} (+1 к смывке).`); } break;
    case 'backstab': if (await discardForAbility(T.btn.backstab)) { c.backstab.add(p.id); c.pB -= 2; log(`${p.name}: ${T.btn.backstab}! ${c.fighter.name} получает −2.`, 'bad'); } break;
    case 'charm': if (await confirmBox(`${T.btn.charm}: сбросить всю руку (${p.hand.length})? Монстр уйдёт, сокровища ваши, но без уровня.`)) act('charm'); return;
    case 'sacrifice': if (await confirmBox(`Пожертвовать «${p.ally.name}» и сбежать?`)) act('sacrifice'); return;
    case 'run': if (!winning(c) || (await confirmBox('Вы же побеждаете! Всё равно смываться?'))) act('run'); return;
    default: act(a); return;
  }
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btnLog').addEventListener('click', () => document.body.classList.toggle('showlog'));
  $('#logclose').addEventListener('click', () => document.body.classList.remove('showlog'));
  $('#lastlog').addEventListener('click', () => document.body.classList.add('showlog'));
  $('#btnRules').addEventListener('click', () => { if (!modalDepth) showRules(); });
  $('#btnNew').addEventListener('click', async () => {
    if (modalDepth) return;
    if (!G || G.winner || (await confirmBox('Начать новую игру? Текущая партия пропадёт.'))) openSetup();
  });
  openSetup();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
});
