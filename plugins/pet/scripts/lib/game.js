'use strict';
// Game rules: events, stats, XP and levels, item drops, quests, and the
// detection of coding events from Claude Code hook payloads.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const xpNeeded = (level) => 100 * level;

const ITEMS = {
  snack: { name: 'Code Snacks', single: 'Code Snack', icon: '◍', color: 'orange' },
  repellent: { name: 'Bug Repellent', single: 'Bug Repellent', icon: '✣', color: 'pink' },
  coffee: { name: 'Magic Coffee', single: 'Magic Coffee', icon: '◉', color: 'brown' },
  hat: { name: 'Rare Hat', single: 'Rare Hat', icon: '★', color: 'yellow', rare: true },
};

// d = stat deltas. mood = sprite expression. bubble = what the pet says.
const EVENTS = {
  test_pass:    { label: 'Tests passed',         icon: '✔', color: 'green',   d: { happiness: 10, xp: 5 },  mood: 'yay',     bubble: ['yay!', 'all green!', 'passing!'], drop: [['snack', 0.5]] },
  bug_found:    { label: 'Found a bug',          icon: '✘', color: 'red',     d: { happiness: -10 },        mood: 'bug',     bubble: ['oh no...', 'a bug!?'] },
  shielded:     { label: 'Bug Repellent worked', icon: '✣', color: 'pink',    d: {},                        mood: 'yay',     bubble: ['nice try, bug'] },
  bug_fixed:    { label: 'Fixed the bug',        icon: '✚', color: 'green',   d: { xp: 20, happiness: 10 }, mood: 'yay',     bubble: ['squashed it!', 'bug: gone'], drop: [['repellent', 0.35]] },
  commit:       { label: 'Committed changes',    icon: '◆', color: 'cyan',    d: { xp: 15 },                mood: 'commit',  bubble: ['nice!', 'saved!'], drop: [['snack', 0.3]] },
  push:         { label: 'Pushed to GitHub',     icon: '↑', color: 'purple',  d: { xp: 25, happiness: 5 },  mood: 'push',    bubble: ['shipped!', 'to the cloud!'], drop: [['coffee', 0.4]] },
  long_session: { label: 'Long coding session',  icon: '◔', color: 'orange',  d: { energy: -5 },           mood: 'sleepy',  bubble: ['*yawn*', 'break soon?'] },
  idle:         { label: 'Idle for too long...', icon: '…', color: 'gray',    d: { happiness: -10 },        mood: 'sad',     bubble: ['you\'re back!', 'missed you...'] },
  rested:       { label: 'Rested',               icon: '☾', color: 'blue',    d: {},                        mood: 'yay',     bubble: ['refreshed!'] },
  delete:       { label: 'Deleted code',         icon: '✂', color: 'red',     d: { happiness: -20 },        mood: 'shocked', bubble: ['NOOO...', 'not the code!'] },
  error:        { label: 'Huge error',           icon: '✸', color: 'red',     d: { happiness: -30, energy: -10 }, mood: 'fire', bubble: ['bruh...', 'it burns'] },
  level_up:     { label: 'Level up!',            icon: '▲', color: 'yellow',  d: { happiness: 10 },         mood: 'levelup', bubble: ['LEVEL UP!'] },
  rare_item:    { label: 'Got a Rare Hat',       icon: '★', color: 'yellow',  d: { happiness: 15 },         mood: 'hat',     bubble: ['legendary!!'] },
  fed:          { label: 'Ate a Code Snack',     icon: '◍', color: 'orange',  d: { fullness: 20, happiness: 5 }, mood: 'eat', bubble: ['nom nom', 'tasty bytes'] },
  kibble:       { label: 'Ate plain kibble',     icon: '◍', color: 'orange',  d: { fullness: 8 },           mood: 'eat',     bubble: ['...crunchy'] },
  coffee:       { label: 'Drank Magic Coffee',   icon: '◉', color: 'brown',   d: { energy: 30 },            mood: 'yay',     bubble: ['ZOOM!'] },
  played:       { label: 'Played together',      icon: '♪', color: 'pink',    d: { happiness: 15, energy: -10, xp: 5 }, mood: 'play', bubble: ['again! again!', 'wheee'] },
  quest_done:   { label: 'Quest complete',       icon: '⚑', color: 'magenta', d: { xp: 50, happiness: 10 }, mood: 'levelup', bubble: ['quest complete!'] },
};

const QUESTS = [
  { id: 'tests3',  title: 'Pass the tests 3 times',     event: 'test_pass', target: 3 },
  { id: 'fixbug',  title: 'Squash a bug (fail → pass)', event: 'bug_fixed', target: 1 },
  { id: 'commit3', title: 'Make 3 commits',             event: 'commit',    target: 3 },
  { id: 'push2',   title: 'Push to GitHub twice',       event: 'push',      target: 2 },
  { id: 'feed2',   title: 'Feed your pet twice',        event: 'fed',       target: 2 },
  { id: 'play1',   title: 'Play with your pet',         event: 'played',    target: 1 },
];

function newQuest(s) {
  if (s.customQuests && s.customQuests.length) {
    const q = s.customQuests.shift();
    return { id: 'custom', title: q.title, event: 'manual', target: q.target, progress: 0, custom: true };
  }
  const prev = s.quest && s.quest.id;
  const q = pick(QUESTS.filter((x) => x.id !== prev));
  return { ...q, progress: 0 };
}

function ensureQuest(s) {
  if (!s.quest) s.quest = newQuest(s);
}

function onCooldown(s, key, ms, now) {
  if (now - (s.cooldowns[key] || 0) < ms) return true;
  s.cooldowns[key] = now;
  return false;
}

// Applies one event and anything it triggers (level-ups, drops, quests).
// Returns the list of log records created.
function apply(s, type, now, opts = {}) {
  const def = EVENTS[type];
  const d = { ...def.d, ...(opts.d || {}) };
  const rec = { t: now, type, label: opts.label || def.label, d };
  const out = [rec];

  for (const k of ['happiness', 'energy', 'fullness']) {
    if (d[k]) s[k] = clamp(s[k] + d[k]);
  }
  s.counts[type] = (s.counts[type] || 0) + 1;
  s.reaction = { type, mood: def.mood, bubble: opts.bubble || pick(def.bubble), at: now };
  s.log.unshift(rec);

  for (const [item, p] of def.drop || []) {
    if (Math.random() < p) {
      s.inventory[item] = (s.inventory[item] || 0) + 1;
      rec.drop = item;
    }
  }

  if (d.xp) {
    s.xp += d.xp;
    while (s.xp >= xpNeeded(s.level)) {
      s.xp -= xpNeeded(s.level);
      s.level += 1;
      out.push(...apply(s, 'level_up', now, { label: `Level up! Lv.${s.level - 1} → ${s.level}` }));
    }
    // A small chance on every XP gain, guaranteed by level 10.
    if (!s.inventory.hat && (Math.random() < 0.02 || s.level >= 10)) {
      s.inventory.hat = 1;
      s.hatOn = true;
      out.push(...apply(s, 'rare_item', now));
    }
  }

  ensureQuest(s);
  if (s.quest.event === type) out.push(...progressQuest(s, now));

  s.log = s.log.slice(0, 40);
  return out;
}

function progressQuest(s, now, steps = 1) {
  s.quest.progress = Math.min(s.quest.target, s.quest.progress + steps);
  if (s.quest.progress < s.quest.target) return [];
  const done = s.quest;
  s.questsDone += 1;
  s.inventory.snack += 1;
  s.quest = newQuest(s);
  return apply(s, 'quest_done', now, { label: `Quest done: ${done.title}` });
}

// Time passing: hunger, rest while away, idle penalty, long sessions.
function tick(s, now) {
  const out = [];
  const decaySteps = Math.floor((now - s.lastDecay) / (15 * MIN));
  if (decaySteps > 0) {
    s.fullness = clamp(s.fullness - decaySteps);
    s.lastDecay += decaySteps * 15 * MIN;
  }

  const gap = now - s.lastSeen;
  if (gap >= 20 * MIN) {
    const gain = Math.min(100 - s.energy, Math.floor(gap / (3 * MIN)));
    if (gain >= 5) out.push(...apply(s, 'rested', now, { d: { energy: gain } }));
    s.lastLongAt = now; // a break resets the coding streak
  }
  if (gap >= 45 * MIN && gap < 12 * HOUR) out.push(...apply(s, 'idle', now));

  if (now - s.lastLongAt >= 45 * MIN) {
    out.push(...apply(s, 'long_session', now));
    s.lastLongAt = now;
  }
  s.lastSeen = now;
  ensureQuest(s);
  return out;
}

// ---------- detecting coding events from Bash tool calls ----------

const TEST_RE = /\b((npm|pnpm|yarn|bun)\s+(run\s+)?test\b|npx\s+(jest|vitest|mocha|playwright\s+test)|pytest\b|python3?\s+-m\s+(pytest|unittest)|jest\b|vitest\b|mocha\b|go\s+test\b|cargo\s+(test|nextest)\b|mvn\s+(\S+\s+)*test\b|gradlew?\s+(\S+\s+)*test\b|rspec\b|phpunit\b|dotnet\s+test\b|make\s+(test|check)\b|tox\b|deno\s+test\b|mix\s+test\b|ctest\b|swift\s+test\b|rails\s+test\b)/;
const FAIL_RE = /\b[1-9]\d*\s+(failed|failing|failures?|errors?)\b|\bFAIL(ED)?\b|\bTests?:\s+[1-9]\d*\s+failed|test result: FAILED/;
const COMMIT_RE = /(^|[;&|(]\s*)git\s+(-\S+\s+\S+\s+)*commit\b/m;
const PUSH_RE = /(^|[;&|(]\s*)git\s+(-\S+\s+\S+\s+)*push\b/m;
const DELETE_RE = /(^|[;&|(]\s*)(sudo\s+)?(rm|rmdir|unlink|git\s+rm)\s+/m;
const DISPOSABLE_RE = /(node_modules|dist|build|\.next|out|tmp|temp|cache|__pycache__|\.pyc|coverage|target|\.log|\.tmp|\/tmp\/)/;
const ERROR_RE = /error|exception|traceback|panic|fatal|segmentation fault|cannot find|not found|undefined|failed/i;
const QUIET_FAILERS = /^(grep|rg|egrep|fgrep|test|\[|diff|cmp|which|command|type|ls|find|cat|head|tail|stat|pgrep|curl|git\s+diff|git\s+show)\b/;

function firstCommand(cmd) {
  return cmd.trim().replace(/^(cd\s+\S+\s*&&\s*)+/, '').replace(/^(\w+=\S+\s+)+/, '');
}

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function fromBash(s, hookEvent, input, now) {
  const cmd = String((input.tool_input && input.tool_input.command) || '');
  const failed = hookEvent === 'PostToolUseFailure';
  const text = `${textOf(input.tool_response)}\n${textOf(input.error)}`;
  const out = [];

  if (TEST_RE.test(cmd)) {
    if (failed || FAIL_RE.test(text)) {
      if (!s.lastTestFailed) {
        if (s.inventory.repellent > 0) {
          s.inventory.repellent -= 1;
          out.push(...apply(s, 'shielded', now));
        } else {
          out.push(...apply(s, 'bug_found', now));
        }
      }
      s.lastTestFailed = true;
    } else {
      out.push(...apply(s, 'test_pass', now));
      if (s.lastTestFailed) out.push(...apply(s, 'bug_fixed', now));
      s.lastTestFailed = false;
    }
    return out;
  }

  if (failed) {
    if (!QUIET_FAILERS.test(firstCommand(cmd)) && ERROR_RE.test(text) && !onCooldown(s, 'error', 10 * MIN, now)) {
      out.push(...apply(s, 'error', now));
    }
    return out;
  }

  if (COMMIT_RE.test(cmd) && !/--dry-run/.test(cmd) && !/nothing to commit|no changes added/.test(text)) {
    out.push(...apply(s, 'commit', now));
  }
  if (PUSH_RE.test(cmd) && !/--dry-run/.test(cmd) && !/Everything up-to-date/.test(text)) {
    out.push(...apply(s, 'push', now));
  }
  if (DELETE_RE.test(cmd) && !DISPOSABLE_RE.test(cmd) && !onCooldown(s, 'delete', 10 * MIN, now)) {
    out.push(...apply(s, 'delete', now));
  }
  return out;
}

// ---------- player actions ----------

function feed(s, what, now) {
  const item = (what || '').toLowerCase();
  if (/coffee/.test(item)) {
    if (!s.inventory.coffee) return { ok: false, msg: 'No Magic Coffee left. Push to GitHub to find some.' };
    s.inventory.coffee -= 1;
    return { ok: true, recs: apply(s, 'coffee', now) };
  }
  if (item && !/snack|food|kibble/.test(item)) {
    return { ok: false, msg: `Can't eat "${what}". Try: snack, coffee.` };
  }
  if (s.fullness >= 98) return { ok: false, msg: `${s.name} is too full to eat right now.` };
  if (s.inventory.snack > 0 && !/kibble/.test(item)) {
    s.inventory.snack -= 1;
    return { ok: true, recs: apply(s, 'fed', now) };
  }
  if (now - s.lastKibble < 30 * MIN) {
    return { ok: false, msg: 'Out of Code Snacks, and the kibble bowl refills in a bit. Pass some tests to earn snacks!' };
  }
  s.lastKibble = now;
  return { ok: true, recs: apply(s, 'kibble', now) };
}

function play(s, now) {
  if (s.energy < 15) return { ok: false, msg: `${s.name} is too tired to play. Try /pet:feed coffee or take a break.` };
  return { ok: true, recs: apply(s, 'played', now) };
}

module.exports = {
  MIN, HOUR, ITEMS, EVENTS, QUESTS, xpNeeded,
  apply, tick, fromBash, feed, play, ensureQuest, newQuest, progressQuest,
};
