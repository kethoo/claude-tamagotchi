'use strict';
// Everything that turns pet state into text: the live ANSI panel, the plain
// status shown by /pet:status, the one-line statusline, and hook messages.
const sprites = require('./sprites');
const { ITEMS, EVENTS, QUESTS, xpNeeded, MIN } = require('./game');

// ---------- color ----------
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM || '') ||
  /iTerm|WezTerm|vscode|ghostty|kitty|Hyper/i.test(process.env.TERM_PROGRAM || '') ||
  /kitty|ghostty|alacritty|wezterm/i.test(process.env.TERM || '');
const NO_COLOR = 'NO_COLOR' in process.env;

const C = {
  green: '#5BD27A', red: '#FF5C6C', cyan: '#5CCFE6', purple: '#B48CFF', orange: '#FFA552',
  yellow: '#FFD866', gray: '#8A8AA0', blue: '#78A6FF', pink: '#FF8FC8', magenta: '#E07CFF',
  brown: '#C8915A', text: '#E6E6F0', dim: '#5E5C72', faint: '#3A3850', accent: '#C9A7FF',
  border: '#4A4766', track: '#2E2C40',
};

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function to256([r, g, b]) {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    if (r < 8) return 16;
    if (r > 246) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const q = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}
function code(h, layer) {
  if (NO_COLOR || !h) return '';
  const c = rgb(C[h] || h);
  return TRUECOLOR ? `\x1b[${layer};2;${c.join(';')}m` : `\x1b[${layer};5;${to256(c)}m`;
}
const RESET = NO_COLOR ? '' : '\x1b[0m';
const BOLD = NO_COLOR ? '' : '\x1b[1m';
const paint = (s, color, bold) => (NO_COLOR ? s : `${bold ? BOLD : ''}${code(color, 38)}${s}${RESET}`);

// ---------- text width ----------
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(ANSI_RE, '');
function cpWidth(cp) {
  if (cp >= 0x1f000) return 2;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60)) return 2;
  if ([0x26a1, 0x2615, 0x2705, 0x2728, 0x2b50, 0x231b, 0x23f0, 0x274c].includes(cp)) return 2;
  if (cp === 0xfe0f || cp === 0x200d) return 0;
  return 1;
}
const width = (s) => Array.from(strip(s)).reduce((n, ch) => n + cpWidth(ch.codePointAt(0)), 0);
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));
const padLeft = (s, w) => ' '.repeat(Math.max(0, w - width(s))) + s;
function truncate(s, w) {
  let out = '';
  for (const ch of Array.from(s)) {
    if (width(out + ch) > w - 1) return out + '…';
    out += ch;
  }
  return out;
}

// ---------- mood + speech ----------
const ENCOURAGE = ['you got this!', 'looking good!', 'ship it!', 'one more test?', 'i believe in you', '*purr*', 'nice code today'];
const REACTION_MS = 90 * 1000;

function currentMood(s, now = Date.now()) {
  if (s.reaction && now - s.reaction.at < REACTION_MS) {
    return { mood: s.reaction.mood, bubble: s.reaction.bubble };
  }
  if (now - s.lastSeen > 20 * MIN) return { mood: 'sleeping', bubble: 'zzz...' };
  if (s.energy < 20) return { mood: 'sleepy', bubble: 'so... tired...' };
  if (s.fullness < 25) return { mood: 'hungry', bubble: 'feed me...?' };
  if (s.happiness < 30) return { mood: 'sad', bubble: '...' };
  if (s.happiness >= 90) return { mood: 'love', bubble: ENCOURAGE[Math.floor(now / 60000) % ENCOURAGE.length] };
  return { mood: 'idle', bubble: ENCOURAGE[Math.floor(now / 60000) % ENCOURAGE.length] };
}

const SPECIES_EMOJI = { cat: '🐱', bunny: '🐰', bear: '🐻' };

// ---------- sprite canvas ----------
// Effects are placed in a canvas around the 22x(H/2) sprite. Coordinates are
// [row, col, glyph, color]; sprite sits at column 5, row 1 (bob shifts it to row 0).
const SX = 5;
function effects(name, frame) {
  const a = frame % 2 === 0;
  switch (name) {
    case 'sparkle': return [[1, 1, a ? '+' : '·', 'yellow'], [3, 29, a ? '✦' : '+', 'yellow'], [7, 0, a ? '·' : '+', 'yellow']];
    case 'sparkle2': return [[0, 27, a ? '·' : '✧', 'yellow'], [5, 1, a ? '✦' : '·', 'yellow'], [8, 29, a ? '+' : '·', 'yellow']];
    case 'bug': return [[6, 28, '✱', 'red'], [5, 29, a ? '\'' : ',', 'red'], [5, 27, a ? ',' : '\'', 'red']];
    case 'zzz': return a ? [[3, 27, 'z', 'blue'], [2, 28, 'Z', 'blue'], [0, 29, 'Z', 'blue']]
                         : [[2, 27, 'z', 'blue'], [1, 28, 'z', 'blue'], [0, 29, 'Z', 'blue']];
    case 'sweat': return [[2, 27, '♦', 'blue'], [1, 1, '!', 'yellow'], [1, 2, '!', 'yellow']];
    case 'trash': return [[7, 28, '▟', 'red'], [7, 29, '▙', 'red'], [6, 28, '▁', 'red'], [6, 29, '▁', 'red']];
    case 'flames': return [[3, 1, a ? '▲' : '♠', 'orange'], [5, 0, a ? '♠' : '▲', 'red'], [7, 2, '▲', a ? 'orange' : 'red'],
      [2, 28, a ? '♠' : '▲', 'red'], [6, 29, a ? '▲' : '♠', 'orange']];
    case 'warn': return [[4, 28, '⚠', 'yellow']];
    case 'rays': return [[1, 3, '╲', 'yellow'], [1, 26, '╱', 'yellow'], [4, 0, '─', 'yellow'], [4, 1, '─', 'yellow'],
      [4, 28, '─', 'yellow'], [4, 29, '─', 'yellow']];
    case 'save': return [[6, 28, '▣', 'cyan']];
    case 'arrows': return [[a ? 2 : 1, 1, '↑', 'purple'], [a ? 1 : 2, 28, '↑', 'purple'], [5, 29, '↑', 'purple']];
    case 'crumbs': return [[8, 27, '·', 'brown'], [8, 29, '•', 'brown'], [7, 28, a ? '◍' : '·', 'orange']];
    case 'drool': return [[6, 28, a ? '◍' : '?', 'orange']];
    case 'notes': return [[1, 27, a ? '♪' : '♫', 'pink'], [3, 1, a ? '♫' : '♪', 'pink']];
    case 'hearts': return [[0, 2, '♥', 'pink'], [a ? 2 : 3, 28, '♥', 'pink']];
    default: return [];
  }
}

// Returns an array of lines (ANSI), each CANVAS_W wide.
const CANVAS_W = 31;
function spriteLines(s, mood, frame = 0) {
  const blink = frame % 9 === 0;
  const { rows, palette, mood: m } = sprites.build({ species: s.species, theme: s.theme, mood, hat: s.hatOn, blink });
  const termRows = rows.length / 2;
  const top = m.bob && frame % 2 === 0 ? 0 : 1;
  const H = termRows + 3; // spare row for bob + shadow
  const cells = Array.from({ length: H }, () => Array(CANVAS_W).fill(' '));
  const dim = m.dim ? 0.55 : 1;
  const col = (ch) => {
    if (ch === '.') return null;
    if (dim === 1) return palette[ch];
    const [r, g, b] = rgb(palette[ch]).map((v) => Math.round(v * dim));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  for (let y = 0; y < termRows; y++) {
    for (let x = 0; x < 22; x++) {
      const t = col(rows[2 * y][x]);
      const b = col(rows[2 * y + 1][x]);
      let cell = ' ';
      if (t && b) cell = NO_COLOR ? '█' : `${code(t, 38)}${code(b, 48)}▀${RESET}`;
      else if (t) cell = NO_COLOR ? '▀' : `${code(t, 38)}▀${RESET}`;
      else if (b) cell = NO_COLOR ? '▄' : `${code(b, 38)}▄${RESET}`;
      cells[y + top][x + SX] = cell;
    }
  }
  // ground shadow
  const shadowRow = termRows + top;
  for (let x = SX + 1; x < SX + 19; x++) cells[shadowRow][x] = paint('▀', 'faint');
  for (const fx of m.fx) {
    for (const [r, c, ch, color] of effects(fx, frame)) {
      if (cells[r] && cells[r][c] === ' ') cells[r][c] = paint(ch, color);
    }
  }
  return cells.map((row) => row.join(''));
}

function bubbleLines(text) {
  const t = ` ${text} `;
  const w = width(t);
  return [
    paint(`╭${'─'.repeat(w)}╮`, 'dim'),
    paint('│', 'dim') + paint(t, 'text', true) + paint('│', 'dim'),
    paint(`╰─╮${'─'.repeat(Math.max(0, w - 2))}╯`, 'dim'),
    paint('  ╰', 'dim'),
  ];
}

function bar(value, max, w, color) {
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * w);
  return paint('━'.repeat(filled), color) + paint('━'.repeat(w - filled), 'track');
}

function ago(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STAT_LABEL = { happiness: 'Happiness', energy: 'Energy', fullness: 'Fullness', xp: 'XP' };
function deltaParts(d) {
  return Object.entries(d).filter(([, v]) => v).map(([k, v]) => ({
    text: `${v > 0 ? '+' : ''}${v} ${STAT_LABEL[k]}`,
    good: k === 'xp' || v > 0,
  }));
}

function questText(s) {
  const q = s.quest;
  if (!q) return 'none';
  return `${q.title} (${q.progress}/${q.target})`;
}

// ---------- full ANSI panel (claude-pet watch / claude-pet) ----------
function panel(s, { now = Date.now(), frame = 0, cols = 80, keys = false } = {}) {
  const { mood, bubble } = currentMood(s, now);
  const LW = 33;
  const RW = 40;
  const wide = cols >= LW + RW + 3;

  // left: bubble + sprite
  const left = [];
  for (const l of bubbleLines(bubble)) left.push(pad('            ' + l, LW));
  for (const l of spriteLines(s, mood, frame)) left.push(pad(' ' + l, LW));

  // right: level, stats, quest
  const need = xpNeeded(s.level);
  const right = [
    '',
    pad(paint(` Lv. ${s.level}`, 'accent', true), 14) + padLeft(paint(`${s.xp} / ${need} XP`, 'gray'), RW - 15),
    ' ' + bar(s.xp, need, RW - 3, 'accent'),
    '',
    stat('♥', 'Happiness', s.happiness, 'red', 'green'),
    stat('↯', 'Energy', s.energy, 'yellow', 'cyan'),
    stat('●', 'Fullness', s.fullness, 'orange', 'yellow'),
    '',
    paint(' ⚑ Current Quest', 'magenta', true),
    '   ' + paint(truncate(s.quest ? s.quest.title : '—', RW - 12), 'cyan') +
      (s.quest ? padLeft(paint(`(${s.quest.progress}/${s.quest.target})`, 'gray'), RW - 4 - width(truncate(s.quest.title, RW - 12))) : ''),
    '',
    paint(` ${s.species} · ${s.theme} · ${s.questsDone} quests done`, 'dim'),
  ];
  function stat(icon, label, v, ic, bc) {
    return ` ${paint(icon, ic)} ${pad(paint(label, 'text'), 10)} ${padLeft(paint(String(v), 'text'), 3)}${paint('/100', 'dim')} ${bar(v, 100, RW - 23, v < 25 ? 'red' : bc)}`;
  }

  const B = (s2) => paint(s2, 'border');
  const title = ` ${paint('★', 'yellow')} ${paint(s.name.toUpperCase(), 'text', true)} ${paint(`· ${s.owner}'s coding companion`, 'gray')} `;
  const out = [];
  if (wide) {
    const inner = LW + 1 + RW;
    out.push(B('╭─') + title + B('─'.repeat(Math.max(0, inner - 1 - width(title))) + '╮'));
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      out.push(B('│') + pad(left[i] || '', LW) + B('│') + pad(right[i] || '', RW) + B('│'));
    }
    section('Recent Activity', inner);
    for (const r of s.log.slice(0, 6)) out.push(B('│') + pad(logLine(r, inner, now), inner) + B('│'));
    if (!s.log.length) out.push(B('│') + pad(paint('  nothing yet — go write some code!', 'dim'), inner) + B('│'));
    section('Inventory', inner);
    out.push(B('│') + pad(' ' + inventoryLine(s), inner) + B('│'));
    const foot = keys
      ? ' [f] feed  [c] coffee  [p] play  [h] hat  [q] quit '
      : ' /pet:status  /pet:feed  /pet:play  /pet:inventory  /pet:quests ';
    out.push(B('╰─') + paint(foot, 'gray') + B('─'.repeat(Math.max(0, inner - 1 - width(foot))) + '╯'));
  } else {
    // narrow terminals: stack everything
    out.push(title);
    out.push(...left, ...right);
    out.push(paint(' Recent', 'gray', true));
    for (const r of s.log.slice(0, 4)) out.push(logLine(r, cols - 1, now));
    out.push(' ' + inventoryLine(s));
    if (keys) out.push(paint(' [f]eed [c]offee [p]lay [h]at [q]uit', 'gray'));
  }
  return out.join('\n');

  function section(name, inner) {
    const t = ` ${name} `;
    out.push(B('├──') + paint(t, 'text', true) + B('─'.repeat(Math.max(0, inner - 2 - width(t))) + '┤'));
  }
}

function logLine(r, w, now) {
  const def = EVENTS[r.type] || { icon: '•', color: 'gray' };
  const parts = deltaParts(r.d).map((p) => paint(p.text, p.good ? 'green' : 'red')).join(' ');
  const drop = r.drop ? paint(` +${ITEMS[r.drop].single}`, 'yellow') : '';
  const label = truncate(r.label, 26);
  const leftPart = `  ${paint(def.icon, def.color)}  ${pad(paint(label, 'text'), 27)}${parts}${drop}`;
  const t = paint(ago(r.t, now), 'dim');
  return pad(leftPart, w - width(t) - 2) + ' ' + t;
}

function inventoryLine(s) {
  return Object.entries(ITEMS).map(([k, it]) => {
    const n = s.inventory[k] || 0;
    const label = `${paint(it.icon, n ? it.color : 'dim')} ${paint(it.name, n ? 'text' : 'dim')} ${paint('x' + n, n ? 'gray' : 'dim')}`;
    return it.rare && n ? `${paint(it.icon, 'yellow')} ${paint(it.name, 'yellow', true)} ${paint('x' + n, 'gray')}` : label;
  }).join('  ');
}

// ---------- plain text (for /pet:* commands, shown inside a code block) ----------
const ASCII = {
  cat:   (f) => ['  /\\_/\\  ', ` ( ${f} ) `, '  > ^ <  '],
  bunny: (f) => ['  (\\_/)  ', ` ( ${f} ) `, '  (")(")  '],
  bear:  (f) => ['  ()_()  ', ` ( ${f} ) `, '  (") (") '],
};
const FACES = {
  idle: 'o.o', love: '^ω^', yay: '^▽^', bug: ';_;', sad: ';_;', commit: '^ω^', push: '^▽^', sleepy: '-_-',
  sleeping: '-_-', shocked: 'O□O', fire: '>_<', levelup: '★▽★', hat: '^ω^', eat: '^o^', hungry: 'o~o', play: '^▽^',
};
const EXTRA = { sleepy: '  z Z', sleeping: '  z Z Z', fire: ' 🔥', bug: ' 🐞', shocked: ' !!', levelup: ' ✨', play: ' ♪', love: ' ♥', yay: ' ✦' };

const pbar = (v, max, w = 16) => '█'.repeat(Math.round((Math.max(0, Math.min(v, max)) / max) * w)).padEnd(w, '░');

function plain(s, { now = Date.now(), recent = 5 } = {}) {
  const { mood, bubble } = currentMood(s, now);
  const art = ASCII[s.species] || ASCII.cat;
  let lines = art(FACES[mood] || 'o.o');
  if (mood === 'levelup') lines = ['  /\\/\\/\\ ', ...lines];
  else if (s.hatOn) lines = ['   _/★\\_ ', ...lines];
  const b = ` ${bubble} `;
  const bub = [`╭${'─'.repeat(width(b))}╮`, `│${b}│`, `╰${'─'.repeat(width(b))}╯`];
  const offset = lines.length - 3;
  const pic = lines.map((l, i) => {
    const j = i - offset;
    const side = j === 0 ? bub[0] : j === 1 ? `◁${bub[1].slice(1)}` : j === 2 ? bub[2] : '';
    return `  ${l.padEnd(11)}${j === 1 ? '' : ' '}${side}${j === 1 ? EXTRA[mood] || '' : ''}`;
  });
  const need = xpNeeded(s.level);
  const out = [
    `★ ${s.name.toUpperCase()} the ${s.species} · Lv.${s.level}   [${pbar(s.xp, need, 20)}] ${s.xp}/${need} XP`,
    '',
    ...pic,
    '',
    `  ♥ Happiness  [${pbar(s.happiness, 100)}] ${String(s.happiness).padStart(3)}/100`,
    `  ↯ Energy     [${pbar(s.energy, 100)}] ${String(s.energy).padStart(3)}/100`,
    `  ● Fullness   [${pbar(s.fullness, 100)}] ${String(s.fullness).padStart(3)}/100`,
    '',
    `  ⚑ Quest: ${questText(s)}`,
  ];
  if (recent && s.log.length) {
    out.push('', '  Recent activity');
    for (const r of s.log.slice(0, recent)) out.push(plainLog(r, now));
  }
  return out.join('\n');
}

function plainLog(r, now) {
  const def = EVENTS[r.type] || { icon: '•' };
  const d = deltaParts(r.d).map((p) => p.text).join(' ');
  const drop = r.drop ? ` (+${ITEMS[r.drop].single})` : '';
  return `  ${def.icon} ${r.label.padEnd(26)} ${(d + drop).padEnd(30)} ${ago(r.t, now)}`;
}

function plainInventory(s) {
  const out = ['Inventory', ''];
  for (const [k, it] of Object.entries(ITEMS)) {
    const n = s.inventory[k] || 0;
    out.push(`  ${it.icon} ${it.name.padEnd(14)} x${n}${it.rare && n ? '  ★ Legendary' + (s.hatOn ? ' (wearing)' : '') : ''}`);
  }
  out.push('', '  Code Snack     /pet:feed         +20 Fullness +5 Happiness',
    '  Magic Coffee   /pet:feed coffee  +30 Energy',
    '  Bug Repellent  used automatically — blocks the next "Found a bug"',
    '  Rare Hat       /pet:hat to wear or take off');
  return out.join('\n');
}

function plainQuests(s) {
  const q = s.quest;
  const out = ['Quests', ''];
  if (q) {
    out.push(`  ⚑ ${q.title}`, `    [${pbar(q.progress, q.target, 12)}] ${q.progress}/${q.target}   reward: +50 XP, +1 Code Snack`);
    if (q.custom) out.push('    (custom quest: tick it with /pet:quests tick)');
  }
  if (s.customQuests.length) {
    out.push('', '  Up next:');
    for (const c of s.customQuests) out.push(`    · ${c.title} (0/${c.target})`);
  }
  out.push('', `  Completed so far: ${s.questsDone}`, '',
    '  /pet:quests add <title> [steps]   add your own quest',
    '  /pet:quests tick [n]              mark progress on a custom quest',
    '  /pet:quests skip                  get a different quest');
  return out.join('\n');
}

// ---------- statusline ----------
function statusline(s, now = Date.now()) {
  const { mood, bubble } = currentMood(s, now);
  const need = xpNeeded(s.level);
  const mini = (v, color) => {
    const n = Math.round((v / 100) * 5);
    return paint('▰'.repeat(n), v < 25 ? 'red' : color) + paint('▱'.repeat(5 - n), 'dim');
  };
  const face = FACES[mood] || 'o.o';
  return [
    `${SPECIES_EMOJI[s.species] || '🐱'} ${paint(s.name, 'text', true)} ${paint(`(${face})`, 'accent')}`,
    paint(`Lv.${s.level}`, 'accent', true) + ' ' + paint(`${Math.round((s.xp / need) * 100)}%`, 'gray'),
    `${paint('♥', 'red')} ${mini(s.happiness, 'green')}`,
    `${paint('↯', 'yellow')} ${mini(s.energy, 'cyan')}`,
    `${paint('●', 'orange')} ${mini(s.fullness, 'yellow')}`,
    paint(`“${bubble}”`, 'gray'),
  ].join(paint(' │ ', 'faint'));
}

// ---------- hook message (shown to the user under the tool call) ----------
function hookMessage(s, recs) {
  const notable = recs.filter((r) => r.type !== 'rested' || recs.length === 1);
  if (!notable.length) return '';
  const emoji = SPECIES_EMOJI[s.species] || '🐱';
  const bubble = s.reaction ? s.reaction.bubble : '';
  const parts = notable.map((r) => {
    const d = deltaParts(r.d).map((p) => p.text.replace(' Happiness', ' ❤️').replace(' Energy', ' ⚡').replace(' Fullness', ' 🍔')).join(' ');
    const drop = r.drop ? `, found ${ITEMS[r.drop].single}!` : '';
    return `${r.label}${d ? ` (${d}${drop})` : drop ? ` (${drop.slice(2)})` : ''}`;
  });
  return `${emoji} ${s.name}: “${bubble}” ${parts.join(' · ')}`;
}

function greeting(s) {
  const emoji = SPECIES_EMOJI[s.species] || '🐱';
  const warn = s.fullness < 25 ? ' — hungry! try /pet:feed' : s.energy < 20 ? ' — sleepy' : '';
  return `${emoji} ${s.name} (Lv.${s.level}) is here · ❤️ ${s.happiness} ⚡ ${s.energy} 🍔 ${s.fullness}${warn}`;
}

module.exports = { panel, plain, plainInventory, plainQuests, statusline, hookMessage, greeting, currentMood, width, strip };
