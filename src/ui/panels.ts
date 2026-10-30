// The bottom panel's HTML for each UI mode. Plain DOM strings; buttons carry
// data-action attributes that app.ts turns into interaction inputs.

import type { ContentPack } from '../engine/content';
import { previewAttack } from '../engine/combat';
import { cityIncome, pillageGold } from '../engine/economy';
import { cityAt } from '../engine/map';
import { fightOrder } from '../engine/fight';
import { sameHex } from '../engine/hex';
import { battleModifiers } from './panelSupport';
import { movesLeft } from '../engine/movement';
import type { BattleReport } from '../engine/types';
import type { PlayerView } from '../engine/vision';
import type { CityCard } from './cityCard';
import type { Mode } from './interaction';
import { oddsCard } from './oddsCard';
import { summarizePath } from './pathSummary';
import { netLabel, type Scoreboard, scoreLine } from './scoreboard';
import { percent, type Strings } from './strings';
import type { Summary } from './summary';
import type { Theme } from './theme';

export interface PanelContext {
  view: PlayerView;
  content: ContentPack;
  strings: Strings;
  theme: Theme;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

function pips(hits: number, max: number): string {
  return `<span class="pips" aria-label="${hits} of ${max} hits">${'<i class="on"></i>'.repeat(hits)}${'<i></i>'.repeat(Math.max(0, max - hits))}</span>`;
}

function bannerFor(ctx: PanelContext, owner: string | null): string {
  const faction = ctx.view.players.find((p) => p.id === owner)?.factionId ?? '';
  const t = ctx.theme.factions[faction];
  return `<span class="banner ${t?.shape ?? 'circle'}" style="--faction:${t?.color ?? ctx.theme.ui.neutral}"></span>`;
}

function stackTitle(ctx: PanelContext, stackId: string): string {
  const stack = ctx.view.stacks[stackId]!;
  const commander = stack.unitIds.map((id) => ctx.content.units[ctx.view.units[id]!.typeId]!).find((t) => t.tags.includes('commander'));
  const n = stack.unitIds.length;
  return commander ? `${commander.name}'s stack` : `Stack of ${n}`;
}

function head(ctx: PanelContext, stackId: string, sub: string): string {
  const stack = ctx.view.stacks[stackId]!;
  return `<div class="panel-head">${bannerFor(ctx, stack.owner)}<div><div class="title">${esc(stackTitle(ctx, stackId))}</div><div class="sub">${esc(sub)}</div></div></div>`;
}

export function idlePanel(): string {
  return `<p class="hint">Tap one of your stacks to select it.</p>`;
}

export function stackPanel(ctx: PanelContext, mode: Extract<Mode, { kind: 'selected' }>): string {
  const { view, content, strings } = ctx;
  const stack = view.stacks[mode.stackId]!;
  const units = stack.unitIds.map((id) => ({ id, unit: view.units[id]!, type: content.units[view.units[id]!.typeId]! }));
  const mods = battleModifiers(units.map((u) => ({ id: u.id, type: u.type, hits: u.unit.hits })));
  const leadership = mods.lines.find((l) => l.source === 'leadership');
  const order = fightOrder(mods.attackers).map((k) => units[k]!);
  const rows = order
    .map(({ id, unit, type }) => {
      const strength = mods.attackers.find((f) => f.id === id)!.strength;
      const wounded = unit.hits < type.hits;
      const detail = wounded ? `<span class="danger">Wounded</span> · Move ${unit.moveLeft} left` : `Str ${type.strength} · Move ${unit.moveLeft} of ${type.move}`;
      const tag = type.tags.includes('commander') ? ' <span class="tag">HERO</span>' : '';
      const picked = mode.split.includes(id) ? ' picked' : '';
      return `<li><button class="unit${picked}" data-action="toggleUnit" data-unit="${esc(id)}" aria-pressed="${picked ? 'true' : 'false'}">
        <span class="unit-main"><span class="name">${esc(type.name)}${tag}</span><span class="sub">${detail}</span></span>
        <span class="unit-side"><span class="str">${Math.round(strength * 100) / 100}</span>${pips(unit.hits, type.hits)}</span></button></li>`;
    })
    .join('');
  const stance = stack.stance;
  const seg = (['hold', 'fall-back', 'evade'] as const)
    .map((k) => `<button data-action="stance" data-stance="${k}" class="${stance.kind === k ? 'on' : ''}">${k === 'hold' ? 'Hold' : k === 'fall-back' ? 'Fall back' : 'Evade'}</button>`)
    .join('');
  const stanceText =
    stance.kind === 'fall-back' ? strings.stances['fall-back'].replace('{threshold}', percent(stance.threshold)) : strings.stances[stance.kind];
  const stepper =
    stance.kind === 'fall-back'
      ? `<div class="stepper"><span>Fall back below</span><button data-action="stanceThreshold" data-delta="-1" aria-label="Lower">−</button><b>${percent(stance.threshold)}</b><button data-action="stanceThreshold" data-delta="1" aria-label="Raise">+</button></div>`
      : '';
  const sub = `${stack.unitIds.length} of 8 units · Move ${movesLeft(view, stack.unitIds)}${leadership ? ` · ${strings.modifiers.leadership} +${leadership.pct}%` : ''}`;
  const split = mode.split.length
    ? `<p class="note">${mode.split.length} picked: tap a hex to move them off as a new stack. <button class="link" data-action="clearSplit">Clear</button></p>`
    : `<p class="note">Tap units to split them off, or tap a hex to move the stack.</p>`;
  const city = cityAt(view, stack.pos);
  const cityLink =
    city && !city.state.razed && city.state.owner === view.viewer
      ? `<button class="city-link" data-action="openCity" data-site="${esc(city.site.id)}">${esc(city.site.name)}: production and garrison ›</button>`
      : '';
  return `${head(ctx, mode.stackId, sub)}${cityLink}
    <div class="cols-head"><span>Fight order, weakest first</span><span>Battle strength · hits</span></div>
    <ul class="units">${rows}</ul>
    ${split}
    <div class="label">If attacked</div>
    <div class="seg">${seg}</div>${stepper}
    <p class="sub">${esc(stanceText)}</p>`;
}

export function movePanel(ctx: PanelContext, mode: Extract<Mode, { kind: 'move' }>): string {
  const { view, content } = ctx;
  const sum = summarizePath(view, content, mode.stackId, mode.split.length ? mode.split : undefined, mode.steps);
  const site = view.map.sites.find((s) => sameHex(s.pos, mode.goal));
  const target = site ? `Toward ${site.name}` : 'To the marked hex';
  const who = mode.split.length ? `${mode.split.length} split off` : `${view.stacks[mode.stackId]!.unitIds.length} units`;
  const left = movesLeft(view, mode.split.length ? mode.split : view.stacks[mode.stackId]!.unitIds);
  return `${head(ctx, mode.stackId, `${who} · Move ${left}`)}
    <div class="route"><span class="route-to">${esc(target)}</span><span class="turns">${sum.turns} turn${sum.turns === 1 ? '' : 's'}</span></div>
    <p class="sub">${esc(sum.costLine)}</p>
    ${sum.warning ? `<p class="warn">${esc(sum.warning)}</p>` : ''}
    <div class="actions"><button data-action="cancel">Cancel</button><button class="primary" data-action="confirm">Move</button></div>`;
}

export function attackPanel(ctx: PanelContext, mode: Extract<Mode, { kind: 'attack' }>): string {
  const { view, content, strings } = ctx;
  // Preview from where the attack will start: after this turn's move, if any.
  const from = mode.path.length ? mode.path[mode.path.length - 1]! : view.stacks[mode.stackId]!.pos;
  const attackerIds = mode.split.length ? mode.split : view.stacks[mode.stackId]!.unitIds;
  const probe: PlayerView = {
    ...view,
    stacks: { ...view.stacks, [mode.stackId]: { ...view.stacks[mode.stackId]!, pos: from, unitIds: attackerIds } },
  };
  const preview = previewAttack(probe, content, mode.stackId, mode.targetId, mode.withdrawBelow || undefined);
  if ('error' in preview) return `<p class="warn">${esc(preview.error)}</p><div class="actions"><button data-action="cancel">Cancel</button></div>`;
  const card = oddsCard(probe, content, strings, mode.stackId, mode.targetId, preview, mode.withdrawBelow);
  const actions = `<div class="actions"><button data-action="cancel">Cancel</button><button class="primary danger-bg" data-action="confirm">Attack</button></div>`;
  if (card.evades) {
    return `<div class="title">${esc(card.title)}</div><div class="sub">${esc(card.subtitle)}</div><p class="note">${esc(card.note)}</p>${actions}`;
  }
  const segLabel: Record<string, string> = { win: 'Win', 'defender-withdraw': 'They fall back', withdraw: 'You withdraw', destroyed: 'Destroyed' };
  const bar = card.segments.map((s) => `<i class="seg-${s.kind}" style="flex:${s.p}" title="${segLabel[s.kind]} ${percent(s.p)}"></i>`).join('');
  const legend = card.segments
    .filter((s) => s.p >= 0.005)
    .map((s) => `<span><i class="seg-${s.kind}"></i>${segLabel[s.kind]} ${percent(s.p)}</span>`)
    .join('');
  const lines = (rows: { label: string; value: string }[]) =>
    rows.map((r) => `<li><span>${esc(r.label)}</span><b class="${r.value.startsWith('−') ? 'danger' : 'good'}">${esc(r.value)}</b></li>`).join('') ||
    '<li><span class="sub">No modifiers</span><b>+0%</b></li>';
  const order = (rows: typeof card.yourOrder) =>
    rows
      .map((r) => `<span class="chip${r.commander ? ' commander' : ''}"><small class="${r.wounded ? 'danger' : ''}">${esc(r.wounded ? 'Wounded' : r.name)}</small><b>${r.strength}</b></span>`)
      .join('');
  const mine = view.players.find((p) => p.id === view.viewer)!;
  const theirs = view.players.find((p) => p.id === view.stacks[mode.targetId]!.owner)!;
  return `<div class="title">${esc(card.title)}</div><div class="sub">${esc(card.subtitle)}</div>
    <div class="odds"><div class="big good">${card.winChance}</div><div class="sub">${esc(card.winLabel)}</div></div>
    <div class="bar">${bar}</div><div class="legend">${legend}</div>
    <div class="label">Expected survivors</div>
    <div class="keep"><span><span class="sub">You keep</span> ${card.youKeep}</span><span><span class="sub">They keep</span> ${card.theyKeep}</span></div>
    <div class="mods"><div><div class="label">Your stack</div><ul>${lines(card.yourLines)}</ul></div><div><div class="label">Defenders</div><ul>${lines(card.theirLines)}</ul></div></div>
    <div class="label">Fight order, weakest first</div>
    <div class="order"><span class="who" style="color:${ctx.theme.factions[mine.factionId]!.color}">You</span>${order(card.yourOrder)}</div>
    <div class="order"><span class="who" style="color:${ctx.theme.factions[theirs.factionId]!.color}">Them</span>${order(card.theirOrder)}</div>
    <div class="stepper"><span>Withdraw if win chance drops below</span><button data-action="withdraw" data-delta="-1" aria-label="Lower">−</button><b>${card.withdrawBelow}</b><button data-action="withdraw" data-delta="1" aria-label="Raise">+</button></div>
    <p class="sub">${esc(card.pursuitNote)}</p>
    ${actions}`;
}

export function resultPanel(ctx: PanelContext, report: BattleReport): string {
  const { strings } = ctx;
  const lost = { attacker: 0, defender: 0 };
  for (const e of report.events) {
    if (e.kind === 'death') lost[e.side]++;
    if (e.kind === 'pursuit' && !e.cleanBreak && e.killed) lost[e.side]++;
  }
  const good = report.outcome === 'win' || report.outcome === 'defender-withdraw' || report.outcome === 'evaded';
  const lines: string[] = [];
  if (report.outcome !== 'evaded') {
    lines.push(`You lost ${lost.attacker} of ${report.attackerUnitIds.length}; they lost ${lost.defender} of ${report.defenderUnitIds.length}.`);
  }
  const pursuit = report.events.find((e) => e.kind === 'pursuit');
  if (pursuit && pursuit.kind === 'pursuit') {
    if (pursuit.cleanBreak) lines.push(pursuit.side === 'attacker' ? 'You broke away cleanly.' : 'They broke away cleanly.');
    else {
      const strikes = report.events.filter((e) => e.kind === 'pursuit' && !e.cleanBreak && e.hit).length;
      lines.push(`Pursuit: ${strikes} strike${strikes === 1 ? '' : 's'} landed on the ${pursuit.side === 'attacker' ? 'withdrawing attackers' : 'retreating defenders'}.`);
    }
  }
  if (report.defenderRetreatTo) lines.push('The defenders fell back to a hex behind them.');
  if (report.attackerAdvanced) lines.push('Your stack moved into the hex.');
  else if (good) lines.push('Your stack could not enter the hex and stays where it was.');
  return `<div class="title ${good ? 'good' : 'danger'}">${esc(strings.outcomes[report.outcome])}</div>
    ${lines.map((l) => `<p class="sub">${esc(l)}</p>`).join('')}
    <div class="actions"><button class="primary" data-action="continue">Continue</button></div>`;
}

export function cityPanel(ctx: PanelContext, card: CityCard): string {
  const head = `<div class="panel-head">${bannerFor(ctx, card.owner)}<div><div class="title">${esc(card.name)}</div><div class="sub">${esc(card.subtitle)}</div></div></div>`;
  const holding = card.holding ? `<p class="note">${esc(card.holding)}</p>` : '';
  const close = `<div class="actions"><button data-action="cancel">Close</button></div>`;
  if (!card.mine) {
    const owner = card.owner ? ctx.content.factions[ctx.view.players.find((p) => p.id === card.owner)!.factionId]!.name : null;
    const who = card.razed ? '' : owner ? `Held by the ${owner}.` : 'Neutral: move a stack in to take it.';
    return `${head}${who ? `<p class="note">${esc(who)}</p>` : ''}${holding}<p class="sub">Garrison: ${esc(card.garrison)}</p>${close}`;
  }
  const b = card.building;
  const building = b
    ? `<div class="building"><div class="row"><b>Building ${esc(b.name)}</b><span class="sub">${b.progress} of ${b.turns} turn${b.turns === 1 ? '' : 's'}</span></div>
        <div class="progress"><i style="width:${Math.round((100 * b.progress) / b.turns)}%"></i></div>
        <p class="sub">${esc(b.status)}</p></div>`
    : `<div class="building idle"><b>Nothing in production</b><p class="sub">Pick a unit below. It is paid for when it is ready.</p></div>`;
  const rows = card.options
    .map(
      (o) => `<li><button class="build-row${o.current ? ' on' : ''}" data-action="build" data-unit="${esc(o.unitTypeId)}" aria-pressed="${o.current}">
        <span class="unit-main"><span class="name">${esc(o.name)}</span><span class="sub">${esc(o.stats)}</span></span>
        <span class="price"><b class="${o.affordable ? '' : 'danger'}">${o.cost} g</b><span class="sub">${o.turns} turn${o.turns === 1 ? '' : 's'} · ${o.upkeep} a turn</span></span></button></li>`,
    )
    .join('');
  const stop = b ? `<button class="link" data-action="build" data-unit="">Stop production</button>` : '';
  return `${head}${holding}${building}
    <div class="cols-head"><span>Build list</span><span>Cost · time · upkeep</span></div>
    <ul class="units">${rows || '<li class="sub">This city builds nothing.</li>'}</ul>
    <p class="sub">Garrison: ${esc(card.garrison)} ${stop}</p>${close}`;
}

export function capturePanel(ctx: PanelContext, siteId: string): string {
  const site = ctx.view.map.sites.find((s) => s.id === siteId)!;
  const city = ctx.view.cities[siteId]!;
  const tier = ctx.strings.tiers[city.tier];
  const option = (choice: 'occupy' | 'pillage' | 'raze', label: string, cls = '') =>
    `<button class="choice ${cls}" data-action="capture" data-choice="${choice}"><b>${esc(label)}</b><span class="sub">${esc(
      ctx.strings.capture[choice].replace('{gold}', String(pillageGold(city.tier))),
    )}</span></button>`;
  return `<div class="title">You took ${esc(site.name)}</div>
    <div class="sub">${esc(tier)} · ${cityIncome(city.tier)} gold a turn</div>
    <div class="choices">${option('occupy', 'Occupy', 'primary')}${option('pillage', `Pillage: +${pillageGold(city.tier)} gold`)}${option('raze', 'Raze')}</div>`;
}

/** The top bar: treasury and net income, the turn, and the secured-score strip. */
export function topBar(ctx: PanelContext, board: Scoreboard): string {
  const bar = board.scores
    .filter((s) => s.share > 0)
    .map((s) => `<i style="width:${(s.share * 100).toFixed(1)}%;background:${ctx.theme.factions[s.factionId]!.color}"></i>`)
    .join('');
  const stand = board.lastStand
    ? `<span class="danger">Last stand: ${esc(board.lastStand === ctx.view.viewer ? 'you' : ctx.content.factions[ctx.view.players.find((p) => p.id === board.lastStand)!.factionId]!.shortName)}</span>`
    : '';
  const me = ctx.view.players.find((p) => p.id === ctx.view.viewer)!;
  return `<div class="top-row">
      <span class="who">${bannerFor(ctx, me.id)}<span class="faction">${esc(ctx.content.factions[me.factionId]!.shortName)}</span></span>
      <span class="gold"><i class="coin" aria-hidden="true"></i><b>${board.gold}</b><span class="${board.net < 0 ? 'danger' : 'good'}">${netLabel(board.net)}</span></span>
      <span class="turn"><b>Turn ${board.turn}</b> <span class="sub">of ${board.turnLimit}</span></span>
    </div>
    <div class="score">
      <div class="score-bar" role="img" aria-label="Secured income: ${esc(scoreLine(board))}; win at ${board.target}"><div class="fill">${bar}</div><i class="mark" style="left:${board.targetShare * 100}%"></i></div>
      <div class="score-line"><span>${esc(scoreLine(board))}</span>${stand}<span>Win at ${board.target}</span></div>
    </div>`;
}

export function summaryOverlay(ctx: PanelContext, summary: Summary): string {
  const bars = summary.board.scores
    .filter((s) => !s.eliminated)
    .map((s) => {
      const color = ctx.theme.factions[s.factionId]!.color;
      return `<div class="sbar"><span>${esc(s.label)} ${s.score}</span><div><i style="width:${(s.share * 100).toFixed(1)}%;background:${color}"></i><b style="left:${summary.board.targetShare * 100}%"></b></div></div>`;
    })
    .join('');
  const items = summary.items
    .map((i) => `<li class="${i.tone}"><b>${esc(i.title)}</b><span class="sub">${esc(i.detail)}</span></li>`)
    .join('');
  const player = ctx.view.players.find((p) => p.id === ctx.view.viewer)!;
  return `<div class="summary-card">
    <div class="summary-head">${bannerFor(ctx, player.id)}<div><h2>Turn ${summary.turn}</h2><div class="sub">${esc(ctx.content.factions[player.factionId]!.name)} · while you were away</div></div></div>
    <div class="label">Secured income <span class="sub inline">Win at ${summary.board.target} of ${summary.board.total}</span></div>
    <div class="sbars">${bars}</div>
    <p class="economy">${esc(summary.economy)}</p>
    ${summary.lastStand ? `<p class="warn">${esc(summary.lastStand)}</p>` : ''}
    <ul class="events">${items || '<li class="neutral"><b>A quiet turn</b><span class="sub">Nothing happened to your realm.</span></li>'}</ul>
    <p class="sub">${esc(summary.leader)}</p>
    <button class="primary" data-input="continue">Start turn</button>
  </div>`;
}

export function gameOverOverlay(ctx: PanelContext): string {
  const w = ctx.view.winner!;
  const why = { domination: 'by domination', 'last-standing': 'as the last player standing', 'turn-limit': 'on score when the last turn ended' }[w.reason];
  // Hot-seat: whoever holds the device may not be the viewer, so name the winner rather than saying "you".
  const title =
    w.playerId === null ? 'A draw' : `Victory for the ${ctx.content.factions[ctx.view.players.find((p) => p.id === w.playerId)!.factionId]!.name}`;
  const detail = w.playerId === null ? 'Equal score and equal armies when the last turn ended.' : `Won ${why}.`;
  return `<div class="handoff-card">${w.playerId ? bannerFor(ctx, w.playerId).replace('class="banner', 'class="banner big') : ''}
    <h2>${esc(title)}</h2><p>${esc(detail)}</p><button class="primary" data-input="newGame">New game</button></div>`;
}
