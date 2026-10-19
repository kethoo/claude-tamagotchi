#!/usr/bin/env node
'use strict';
// claude-pet: a tamagotchi that lives in Claude Code.
// Usage: node pet.js <command> [args]   (run `node pet.js help`)
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./lib/state');
const game = require('./lib/game');
const render = require('./lib/render');
const sprites = require('./lib/sprites');

const ROOT = path.resolve(__dirname, '..');
const [cmd = 'status', ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const words = args.filter((a) => !a.startsWith('--'));
const isTTY = process.stdout.isTTY;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function say(recs, s) {
  return render.hookMessage(s, recs) || '';
}

const commands = {
  // Called by hooks/hooks.json. Must only ever print JSON (or nothing).
  hook() {
    const event = words[0] || '';
    let input = {};
    try { input = JSON.parse(readStdin() || '{}'); } catch {}
    const now = Date.now();
    const { msg } = store.update((s) => {
      const recs = game.tick(s, now);
      let greet = false;
      if (event === 'SessionStart') {
        writeRoot();
        greet = input.source === 'startup';
      }
      if ((event === 'PostToolUse' || event === 'PostToolUseFailure') && input.tool_name === 'Bash') {
        recs.push(...game.fromBash(s, event, input, now));
      }
      let msg = say(recs, s);
      if (greet && !msg) msg = render.greeting(s);
      return { msg };
    });
    if (msg) process.stdout.write(JSON.stringify({ systemMessage: msg }) + '\n');
  },

  status() {
    const s = store.load();
    if (flags.has('--plain') || !isTTY) console.log(render.plain(s));
    else console.log(render.panel(s, { cols: process.stdout.columns || 80 }));
  },

  statusline() {
    readStdin();
    process.stdout.write(render.statusline(store.load()) + '\n');
  },

  watch() {
    if (!isTTY) return console.log(render.plain(store.load()));
    let frame = 0;
    let state = store.load();
    let mtime = 0;
    const out = process.stdout;
    out.write('\x1b[?1049h\x1b[?25l');
    const restore = () => { out.write('\x1b[?25h\x1b[?1049l'); process.exit(0); };
    process.on('SIGINT', restore);
    process.on('SIGTERM', restore);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (b) => {
        const k = b.toString();
        if (k === 'q' || k === '\x03') restore();
        const now = Date.now();
        const act = { f: (s) => game.feed(s, '', now), c: (s) => game.feed(s, 'coffee', now), p: (s) => game.play(s, now),
          h: (s) => { if (s.inventory.hat) s.hatOn = !s.hatOn; return {}; } }[k];
        if (act) { state = store.update((s) => { s.lastSeen = now; act(s); return s; }); draw(); }
      });
    }
    function draw() {
      const cols = out.columns || 80;
      const text = render.panel(state, { frame, cols, keys: true });
      out.write('\x1b[H\x1b[2J' + text);
    }
    setInterval(() => {
      try {
        const m = fs.statSync(store.STATE_FILE).mtimeMs;
        if (m !== mtime) { mtime = m; state = store.load(); }
      } catch {}
      frame++;
      draw();
    }, 600);
    draw();
  },

  feed() {
    const now = Date.now();
    const r = store.update((s) => { const res = game.feed(s, words.join(' '), now); return { res, s }; });
    if (!r.res.ok) return console.log(r.res.msg);
    console.log(render.plain(r.s, { recent: 0 }));
    console.log('\n' + say(r.res.recs, r.s));
  },

  play() {
    const now = Date.now();
    const r = store.update((s) => ({ res: game.play(s, now), s }));
    if (!r.res.ok) return console.log(r.res.msg);
    console.log(render.plain(r.s, { recent: 0 }));
    console.log('\n' + say(r.res.recs, r.s));
  },

  hat() {
    const s = store.update((st) => { if (st.inventory.hat) st.hatOn = !st.hatOn; return st; });
    if (!s.inventory.hat) return console.log(`${s.name} hasn't found the Rare Hat yet. Keep coding — it drops rarely, and always by level 10.`);
    console.log(`${s.name} ${s.hatOn ? 'puts on' : 'takes off'} the Rare Hat.`);
  },

  inventory() { console.log(render.plainInventory(store.load())); },

  quests() {
    const sub = (words[0] || '').toLowerCase();
    const now = Date.now();
    const s = store.update((st) => {
      game.ensureQuest(st);
      if (sub === 'add') {
        const rest = words.slice(1);
        const n = /^\d+$/.test(rest[rest.length - 1] || '') ? parseInt(rest.pop(), 10) : 1;
        const title = rest.join(' ').replace(/^["']|["']$/g, '').trim();
        if (title) {
          st.customQuests.push({ title, target: Math.max(1, Math.min(20, n)) });
          if (!st.quest.custom && st.quest.progress === 0) st.quest = game.newQuest(st);
        }
      } else if (sub === 'tick') {
        if (st.quest.custom) game.progressQuest(st, now, parseInt(words[1] || '1', 10) || 1);
      } else if (sub === 'skip') {
        st.quest = game.newQuest(st);
      }
      return st;
    });
    console.log(render.plainQuests(s));
  },

  name() {
    const name = words.join(' ').trim().slice(0, 20);
    if (!name) return console.log('Usage: name <new name>');
    store.update((s) => { s.name = name; });
    console.log(`Your pet is now called ${name}.`);
  },

  species() {
    const [sp, theme] = words.map((w) => w.toLowerCase());
    const okSp = sprites.SPECIES;
    const okTh = Object.keys(sprites.THEMES);
    if (!sp || (!okSp.includes(sp) && !okTh.includes(sp))) {
      return console.log(`Species: ${okSp.join(', ')}\nThemes:  ${okTh.join(', ')}\nUsage: species <species> [theme]   or   species <theme>`);
    }
    const s = store.update((st) => {
      if (okSp.includes(sp)) st.species = sp; else st.theme = sp;
      if (theme && okTh.includes(theme)) st.theme = theme;
      return st;
    });
    console.log(`${s.name} is now a ${s.theme} ${s.species}.\n`);
    console.log(render.plain(s, { recent: 0 }));
  },

  // Simulate events, handy for trying the pet out: demo test_pass, demo error...
  demo() {
    const type = words[0];
    if (!game.EVENTS[type]) return console.log(`Events: ${Object.keys(game.EVENTS).join(', ')}`);
    const now = Date.now();
    const r = store.update((s) => {
      if (type === 'level_up') { // grant just enough XP to level up for real
        return { recs: game.apply(s, 'played', now, { d: { xp: game.xpNeeded(s.level) - s.xp, happiness: 0, energy: 0 }, label: 'Demo XP' }), s };
      }
      return { recs: game.apply(s, type, now), s };
    });
    console.log(say(r.recs, r.s));
  },

  setup() {
    writeRoot();
    const { launcher, shim, bin } = installShim();
    const lines = [`✔ Installed the claude-pet command at ${shim}`];
    const link = linkIntoPath(shim);
    if (link) lines.push(`✔ Linked it as ${link}`);
    else if (process.platform === 'win32') lines.push(`  To run it by name, add this folder to your PATH:  ${bin}`);
    else lines.push(`  To run it by name, add this to your shell profile:  alias claude-pet='${shim}'`);
    if (!flags.has('--no-statusline')) lines.push(configureStatusline(launcher));
    lines.push('',
      'Next: open a second terminal pane next to Claude Code and run',
      '    claude-pet watch',
      'to see your pet live, in color. It reacts as you code.');
    console.log(lines.join('\n'));
  },

  reset() {
    if (!flags.has('--yes')) return console.log('This starts over with a brand new pet. Run `reset --yes` to confirm.');
    store.save(store.defaultState());
    console.log('A new pet has hatched. Say hi!');
  },

  help() {
    console.log([
      'Claude Tamagotchi — a pet that lives in Claude Code',
      '',
      '  /pet:status              see your pet, stats and recent activity',
      '  /pet:feed [coffee]       feed a Code Snack (or Magic Coffee for energy)',
      '  /pet:play                play together (+happiness, −energy)',
      '  /pet:inventory           items you have collected',
      '  /pet:quests [add|tick|skip]  current quest, or add your own',
      '  /pet:hat                 wear or take off the Rare Hat',
      '  /pet:name <name>         rename your pet',
      '  /pet:species <s> [theme] cat, bunny, bear · calico, gray, orange, black, snow, mint',
      '  /pet:setup               install `claude-pet` + the statusline',
      '',
      'In a separate terminal:  claude-pet watch   (live pixel-art view)',
      '',
      'What your pet reacts to',
      '  ✔ tests pass  +10 ♥ +5 XP     ✘ tests fail  −10 ♥     ✚ fail → pass  +20 XP',
      '  ◆ git commit  +15 XP          ↑ git push   +25 XP +5 ♥',
      '  ✂ deleting files  −20 ♥       ✸ big errors −30 ♥ −10 energy',
      '  ◔ long sessions −5 energy     … gone 45m+  −10 ♥   ☾ breaks restore energy',
      '  Level up every 100 × level XP. Items drop as you work.',
    ].join('\n'));
  },
};

// ---------- setup helpers ----------
function writeRoot() {
  try {
    fs.mkdirSync(store.HOME, { recursive: true });
    fs.writeFileSync(path.join(store.HOME, 'root'), ROOT);
  } catch {}
}

// A small node launcher (works on every OS) plus a convenience wrapper:
// a shell script on macOS/Linux, a .cmd file on Windows. Both always run the
// newest installed plugin version, found through ~/.claude-pet/root.
function installShim() {
  const bin = path.join(store.HOME, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const launcher = path.join(bin, 'claude-pet.js');
  fs.writeFileSync(launcher, [
    '#!/usr/bin/env node',
    '// Launcher for the Claude Tamagotchi plugin. Points at the newest installed version.',
    "const fs = require('fs'), path = require('path'), os = require('os');",
    "const home = process.env.CLAUDE_PET_HOME || path.join(os.homedir(), '.claude-pet');",
    "let root = '';",
    "try { root = fs.readFileSync(path.join(home, 'root'), 'utf8').trim(); } catch {}",
    `if (!fs.existsSync(path.join(root, 'scripts', 'pet.js'))) root = ${JSON.stringify(ROOT)};`,
    "const entry = path.join(root, 'scripts', 'pet.js');",
    'process.argv[1] = entry;',
    'require(entry);',
    '',
  ].join('\n'));
  const fwd = launcher.split(path.sep).join('/');
  if (process.platform === 'win32') {
    const cmdFile = path.join(bin, 'claude-pet.cmd');
    fs.writeFileSync(cmdFile, `@echo off\r\nnode "${launcher}" %*\r\n`);
    return { launcher: fwd, shim: cmdFile, bin };
  }
  const shim = path.join(bin, 'claude-pet');
  fs.writeFileSync(shim, `#!/bin/sh\nexec node "${launcher}" "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return { launcher: fwd, shim, bin };
}

function linkIntoPath(shim) {
  if (process.platform === 'win32') return null;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const local = path.join(os.homedir(), '.local', 'bin');
  if (!dirs.includes(local) || !fs.existsSync(local)) return null;
  const link = path.join(local, 'claude-pet');
  try {
    try { fs.unlinkSync(link); } catch {}
    fs.symlinkSync(shim, link);
    return link;
  } catch { return null; }
}

function configureStatusline(launcher) {
  const command = `node "${launcher}" statusline`;
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (fs.existsSync(file)) return '  Skipped the statusline: couldn\'t parse ~/.claude/settings.json';
  }
  if (settings.statusLine) {
    const already = JSON.stringify(settings.statusLine).includes('claude-pet');
    return already ? '✔ Statusline already shows your pet'
      : `  You already have a statusline, so I left it alone. To use the pet's instead, set\n  "statusLine": {"type": "command", "command": ${JSON.stringify(command)}} in ~/.claude/settings.json`;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  settings.statusLine = { type: 'command', command, padding: 0 };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return '✔ Added the pet to your Claude Code statusline (backup: ~/.claude/settings.json.bak)';
}

const run = commands[cmd] || commands.help;
try {
  run();
} catch (e) {
  if (cmd === 'hook') process.exit(0); // never break the user's session
  console.error(`claude-pet: ${e.message}`);
  process.exit(1);
}
