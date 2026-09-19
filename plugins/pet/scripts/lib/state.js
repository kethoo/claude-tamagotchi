'use strict';
// Persistent pet state, stored outside the plugin folder so it survives plugin
// updates and can be read by the standalone `claude-pet` command.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.CLAUDE_PET_HOME || path.join(os.homedir(), '.claude-pet');
const STATE_FILE = path.join(HOME, 'state.json');
const LOCK_FILE = path.join(HOME, '.lock');

function owner() {
  try { return os.userInfo().username || 'you'; } catch { return 'you'; }
}

function defaultState(now = Date.now()) {
  return {
    v: 1,
    name: 'Mochi',
    owner: owner(),
    species: 'cat',
    theme: 'calico',
    created: now,
    level: 1,
    xp: 0,
    happiness: 80,
    energy: 80,
    fullness: 70,
    inventory: { snack: 2, coffee: 1, repellent: 0, hat: 0 },
    hatOn: false,
    quest: null,
    customQuests: [],
    questsDone: 0,
    log: [],
    reaction: null,
    lastSeen: now,
    lastDecay: now,
    lastLongAt: now,
    lastTestFailed: false,
    lastKibble: 0,
    cooldowns: {},
    counts: {},
  };
}

function migrate(s) {
  const d = defaultState(s.created || Date.now());
  const out = Object.assign(d, s);
  out.inventory = Object.assign(defaultState().inventory, s.inventory || {});
  return out;
}

function load() {
  try {
    return migrate(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT' && fs.existsSync(STATE_FILE)) {
      try { fs.copyFileSync(STATE_FILE, STATE_FILE + '.corrupt'); } catch {}
    }
    return defaultState();
  }
}

function save(s) {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Parallel tool calls fire hooks at the same moment; a tiny lock keeps them
// from overwriting each other's changes.
function withLock(fn) {
  fs.mkdirSync(HOME, { recursive: true });
  let fd = null;
  const start = Date.now();
  while (fd === null) {
    try {
      fd = fs.openSync(LOCK_FILE, 'wx');
    } catch {
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 3000) fs.unlinkSync(LOCK_FILE);
      } catch {}
      if (Date.now() - start > 1500) break; // give up waiting, proceed anyway
      sleep(15);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  }
}

function update(fn) {
  return withLock(() => {
    const s = load();
    const result = fn(s);
    save(s);
    return result;
  });
}

module.exports = { HOME, STATE_FILE, load, save, update, defaultState };
