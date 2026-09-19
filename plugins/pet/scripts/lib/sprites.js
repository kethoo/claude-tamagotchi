'use strict';
// Pixel-art pets. Each sprite is drawn as its LEFT HALF only and mirrored,
// which keeps the art symmetric and easy to edit.
//
// Pixel legend
//   .  transparent        o  outline          w  fur (base)
//   p  fur patches        k  pink (ears, cheeks)
//   e  eye                h  eye highlight    m  mouth   r  tongue
//   b  tear               y  gold   R  gem    H  hat     D  hat band   Y  star
//   E/M  eye and mouth slots, filled per mood

const EARS = {
  cat: [
    '.oo......',
    '.oko.....',
    '.okkooooo',
    '.opkpwwww',
  ],
  bunny: [
    '..oo.....',
    '.okko....',
    '.okko....',
    '.okko....',
    '.okkooooo',
    '.opppwwww',
  ],
  bear: [
    '.........',
    '.ooo.....',
    'opkpooooo',
    '.opppwwww',
  ],
};

const HEAD = [
  'opppwwwww',
  'oppwwwwww',
  'opwEEEwww',
  'owwEEEwww',
  'owkkwwwMM',
  'owwwwwwMM',
  '.owwwwwww',
  '..oowwwww',
];

const BODY = [
  '..opwwwww',
  '.oppwwwww',
  '.opwwwwww',
  '.owwowwww',
  '.owwowwww',
  '..ooooooo',
];

// Tail pixels in columns 17-20, touching the body's right edge, one row per BODY row.
const TAILS = {
  cat:   ['..o.', '.opo', '.po.', 'po..', 'o...', '....'],
  bunny: ['....', '....', '....', '.oo.', 'wwo.', 'oo..'],
  bear:  ['....', '....', '....', '....', 'o...', '....'],
};

// Left-eye patterns (3 wide x 2 tall); the right eye is the mirror image.
const EYES = {
  open:   ['whe', 'wee'],
  happy:  ['wew', 'ewe'],
  closed: ['www', 'eee'],
  wide:   ['ehe', 'eee'],
  angry:  ['eew', 'wee'],
  star:   ['wyw', 'yyy'],
};

// Left half of the mouth (2 wide x 2 tall), mirrored to 4 wide.
const MOUTHS = {
  smile: ['mw', 'wm'],
  open:  ['wm', 'mr'],
  frown: ['wm', 'mw'],
  flat:  ['ww', 'mm'],
};

const ACCESSORIES = {
  crown: [
    '.....y..y',
    '.....yyyR',
    '.....yyyy',
    '.........',
  ],
  hat: [
    '........H',
    '.......HH',
    '......HHH',
    '.....HYHH',
    '...DDDDDD',
    '.........',
  ],
};

// mood -> face + effects
const MOODS = {
  idle:    { eyes: 'open',   mouth: 'smile', fx: ['sparkle'] },
  yay:     { eyes: 'happy',  mouth: 'open',  fx: ['sparkle', 'sparkle2'], bob: true },
  bug:     { eyes: 'open',   mouth: 'frown', fx: ['bug'], tear: true },
  sad:     { eyes: 'open',   mouth: 'frown', fx: [], tear: true },
  commit:  { eyes: 'happy',  mouth: 'smile', fx: ['sparkle', 'save'] },
  push:    { eyes: 'happy',  mouth: 'open',  fx: ['arrows'], bob: true },
  sleepy:  { eyes: 'closed', mouth: 'flat',  fx: ['zzz'] },
  sleeping:{ eyes: 'closed', mouth: 'flat',  fx: ['zzz'], dim: true },
  shocked: { eyes: 'wide',   mouth: 'open',  fx: ['sweat', 'trash'] },
  fire:    { eyes: 'angry',  mouth: 'frown', fx: ['flames', 'warn'], palette: 'fire' },
  levelup: { eyes: 'star',   mouth: 'open',  fx: ['rays', 'sparkle'], acc: 'crown', bob: true },
  hat:     { eyes: 'happy',  mouth: 'smile', fx: ['sparkle', 'sparkle2'], acc: 'hat' },
  eat:     { eyes: 'happy',  mouth: 'open',  fx: ['crumbs'] },
  hungry:  { eyes: 'open',   mouth: 'flat',  fx: ['drool'] },
  play:    { eyes: 'happy',  mouth: 'open',  fx: ['notes', 'hearts'], bob: true },
  love:    { eyes: 'happy',  mouth: 'smile', fx: ['hearts'] },
};

const THEMES = {
  calico: { o: '#3B2F4A', w: '#FFF3E4', p: '#C28B5C', k: '#FFADC4', e: '#2A2238', h: '#FFFFFF' },
  gray:   { o: '#2F3142', w: '#EEEEF4', p: '#8B91A8', k: '#FFADC4', e: '#23263A', h: '#FFFFFF' },
  orange: { o: '#4A2E22', w: '#FFE8CC', p: '#EE9440', k: '#FFA8B8', e: '#2E1E18', h: '#FFFFFF' },
  black:  { o: '#14121B', w: '#4B4758', p: '#302D3B', k: '#E58FA8', e: '#F7D046', h: '#FFFFFF' },
  snow:   { o: '#3A3A50', w: '#FFFFFF', p: '#DCDCE8', k: '#FFB3C8', e: '#26263A', h: '#FFFFFF' },
  mint:   { o: '#20403A', w: '#E9FFF6', p: '#72D1B2', k: '#FFB0C0', e: '#1C2E2A', h: '#FFFFFF' },
};

const FIXED = {
  m: '#5A3442', r: '#F06A84', b: '#7CC4FF', y: '#FFD23F', R: '#FF4F6D',
  H: '#7B5CF0', D: '#4B3AA6', Y: '#FFE066',
};

const FIRE = { o: '#6E1A10', w: '#FF8A4C', p: '#E2462A', k: '#FFD166', e: '#3A0E08', h: '#FFE3A3' };

function mirror(half) {
  return half + half.split('').reverse().join('');
}

function put(row, col, str) {
  return row.slice(0, col) + str + row.slice(col + str.length);
}

// Returns { rows: string[] of pixel chars (width 22), palette }
function build({ species = 'cat', theme = 'calico', mood = 'idle', hat = false, blink = false }) {
  const m = MOODS[mood] || MOODS.idle;
  const eyes = EYES[blink && m.eyes === 'open' ? 'closed' : m.eyes];
  const mouth = MOUTHS[m.mouth];

  const head = HEAD.map((r) => r);
  head[2] = put(head[2], 3, eyes[0]);
  head[3] = put(head[3], 3, eyes[1]);
  head[4] = put(head[4], 7, mouth[0]);
  head[5] = put(head[5], 7, mouth[1]);
  if (m.tear) {
    head[4] = put(head[4], 4, 'b');
    head[5] = put(head[5], 4, 'b');
  }

  const tail = TAILS[species] || TAILS.cat;
  const acc = m.acc || (hat ? 'hat' : null);
  const rows = [];
  if (acc) for (const r of ACCESSORIES[acc]) rows.push(mirror(r) + '....');
  for (const r of EARS[species] || EARS.cat) rows.push(mirror(r) + '....');
  for (const r of head) rows.push(mirror(r) + '....');
  BODY.forEach((r, i) => rows.push(mirror(r).slice(0, 17) + tail[i] + '.'));
  if (rows.length % 2) rows.unshift('.'.repeat(22));

  const base = m.palette === 'fire' ? FIRE : THEMES[theme] || THEMES.calico;
  const palette = { ...FIXED, ...base };
  return { rows, palette, mood: m };
}

module.exports = { build, MOODS, THEMES, SPECIES: Object.keys(EARS) };
