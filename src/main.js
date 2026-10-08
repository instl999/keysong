import './styles.css';
import * as Tone from 'tone';
import { Piano } from './engine/piano.js';
import { TypingSensor } from './engine/typing-sensor.js';
import { Arranger } from './engine/state-model.js';
import { Player } from './engine/player.js';
import { Library, hasStems, stemRoles } from './library/library.js';
import { Backing } from './engine/backing.js';
import { Soloist } from './engine/soloist.js';
import { detectKeyAsync, toAnalysisSamples, ANALYSIS_RATE } from './engine/keydetect.js';
import { StemDeck } from './engine/stemdeck.js';
import { Mixer, MODES, ANCHOR_ROLE, availableModes, foregroundRoles } from './engine/gate.js';
import { Touch } from './engine/touch.js';
import { analyzeStems } from './engine/track-analysis.js';
import { Take, BestTakes, CUE_LEAD } from './engine/take.js';
import { renderDemo } from './engine/demo.js';
import { SongMap } from './ui/song-map.js';

const $ = (id) => document.getElementById(id);

// Elements touched on every keystroke or every frame are resolved once. The
// global hook can fire faster than a repeated getElementById is worth paying for.
const el = {
  app: $('app'),
  power: $('power'),
  powerLabel: $('powerLabel'),
  powerHeadline: $('powerHeadline'),
  powerHint: $('powerHint'),
  playPause: $('playPause'),
  next: $('next'),
  order: $('order'),
  orderLabel: $('orderLabel'),
  npTitle: $('npTitle'),
  npComposer: $('npComposer'),
  sourceTag: $('sourceTag'),
  scrub: $('scrub'),
  seekTip: $('seekTip'),
  rail: $('rail'),
  trackProgress: $('trackProgress'),
  trackTime: $('trackTime'),
  trackDuration: $('trackDuration'),
  stRate: $('stRate'),
  scoreRead: $('scoreRead'),
  scoreLabel: $('scoreLabel'),
  scoreValue: $('scoreValue'),
  scoreBest: $('scoreBest'),
  pulseOrb: $('pulseOrb'),
  beatRing: $('beatRing'),
  pulseScope: $('pulseScope'),
  bars: $('bars'),
  mixer: $('mixer'),
  mixerRows: $('mixerRows'),
  statusText: $('statusText'),
  list: $('list'),
  emptyLibrary: $('emptyLibrary'),
  emptyLibraryText: $('emptyLibraryText'),
  emptyLibraryAction: $('emptyLibraryAction'),
  miniButton: $('miniButton'),
  soundButton: $('soundButton'),
  soundPanel: $('soundPanel'),
  volume: $('volume'),
  volumeValue: $('volumeValue'),
  clicks: $('clicks'),
  toast: $('toast'),
  dropzone: $('dropzone'),
  platformLabel: $('platformLabel'),
};

const KEY_KINDS = new Set(['char', 'back', 'enter', 'space']);
const desktop = window.keysongDesktop ?? null;

if (desktop?.isDesktop) document.body.classList.add('desktop');
el.platformLabel.textContent = desktop?.isDesktop ? 'Windows-wide input' : 'Current-window preview';
$('resourceButtonLabel').textContent = desktop?.isDesktop ? 'Music Resources' : 'Import Folder';
if (!desktop?.isDesktop) {
  $('pickDir').title = 'Import a music folder';
  $('pickDir').setAttribute('aria-label', 'Import a music folder');
  $('importHelp').querySelector('.help-title small').textContent = 'Choose a folder manually in browser preview';
  el.emptyLibraryText.textContent = 'Drop a song folder here, or import one. Songs separated into Vocals and Instrumental stems let your typing sing.';
  el.emptyLibraryAction.textContent = 'Import Folder';
}

const piano = new Piano();
const sensor = new TypingSensor();
const arranger = new Arranger();
const player = new Player(piano, arranger);
const library = new Library();
player.mode = 'hybrid';

let backing = null;
let soloist = null;
let deck = null;
let mixer = null;
let touch = null;

let enabled = false;
let isPlaying = false;
let isLoading = false;
let current = null;
let loadedItemId = null;
let currentEngine = null;
let queue = [];
let stemStartOffset = 0;
let orderMode = localStorage.getItem('keysong:order') === 'shuffle' ? 'shuffle' : 'sequence';
let stemMode = MODES[localStorage.getItem('keysong:stemMode')] ? localStorage.getItem('keysong:stemMode') : 'vocal';
let refRate = Number(localStorage.getItem('keysong:refRate')) || 3.2;
let toastTimer = null;
let unduckTimer = null;
let lastRateTune = 0;
let lastUiTick = 0;
let lastSourceTag = '';
let libraryReady = false;
let pendingMusicResource = null;
let powerTransition = false;
let shuffleDeck = [];

// Sound. Every engine plays into one gain, so a single slider sets the music
// level; key clicks can be switched off on their own.
let output = null;
let volume = Number(localStorage.getItem('keysong:volume') ?? 100);
if (!Number.isFinite(volume)) volume = 100;
let clicks = localStorage.getItem('keysong:clicks') !== 'off';

// Performance feedback for stem tracks. The analysis arrives shortly after a
// track starts playing; until it does, the stems simply follow typing.
const songMap = new SongMap($('songMap'));
const bestTakes = new BestTakes(localStorage);
const analysisCache = new Map();   // item id -> analysis, so replays start instantly
let analysis = null;               // Presence lanes and beat grid for the loaded track.
let analysisToken = 0;             // Discards analysis that finishes after a track change.
let take = null;                   // The current play-through of the revealed stem.
let takeBest = null;               // The best earlier take on the same track and stem.
let frameRequest = 0;
let lastMapDraw = 0;
let lastBeatIndex = -1;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Lightweight visual feedback.
const barEls = [];
for (let i = 0; i < 24; i++) {
  const bar = document.createElement('i');
  el.bars.appendChild(bar);
  barEls.push(bar);
}

// The scope is a ring: flex order decides where each bar sits, so a keystroke
// reuses the oldest element instead of destroying and creating one.
const scopeEls = [];
for (let i = 0; i < 23; i++) {
  const bar = document.createElement('i');
  bar.style.order = String(i);
  el.pulseScope.appendChild(bar);
  scopeEls.push(bar);
}
let scopeCursor = 0;
let scopeOrder = scopeEls.length;

function showToast(message, duration = 2600) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add('show');
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), duration);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** @param state Styling for the stem feedback states: 'on', 'cue', or 'break'. */
function setSourceTag(text, state = '') {
  if (text === lastSourceTag && el.sourceTag.dataset.state === state) return;
  lastSourceTag = text;
  el.sourceTag.textContent = text;
  el.sourceTag.dataset.state = state;
}

function setHint(text) {
  if (el.npComposer.textContent !== text) el.npComposer.textContent = text;
}

let orbAnimations = null;

/** The ring around the orb breathes on each beat of the song. */
function pulseBeat(period) {
  el.beatRing.animate(reducedMotion.matches
    ? [{ opacity: 0.35 }, { opacity: 0 }]
    : [{ opacity: 0.45, transform: 'scale(.94)' }, { opacity: 0, transform: 'scale(1.12)' }],
  { duration: Math.min(420, period * 800), easing: 'ease-out' });
}

/** A keystroke that lands on the beat lights the ring gold. */
function flashInTime() {
  el.beatRing.animate(reducedMotion.matches
    ? [{ opacity: 0.9 }, { opacity: 0 }]
    : [
      { opacity: 0.95, transform: 'scale(1)', boxShadow: '0 0 14px rgba(231, 189, 79, .55)' },
      { opacity: 0, transform: 'scale(1.3)', boxShadow: '0 0 0 rgba(231, 189, 79, 0)' },
    ],
  { duration: 380, easing: 'cubic-bezier(.2, .7, .3, 1)' });
}

/**
 * @param inTime With a beat grid, whether the key landed on the beat; null
 *   when there is no grid to judge against.
 */
function animateInput(kind, inTime = null) {
  // Restarting the keyframes through the animation API avoids the classic
  // remove-class / read-offsetWidth / add-class trick, which forces a
  // synchronous layout on every single key. The lookup itself flushes pending
  // style, so it happens once and the objects are reused from then on.
  if (!orbAnimations?.length) {
    el.pulseOrb.classList.add('hit');
    orbAnimations = el.pulseOrb.getAnimations({ subtree: true });
  }
  for (const animation of orbAnimations) {
    animation.currentTime = 0;
    animation.play();
  }
  if (inTime) flashInTime();

  // With a beat grid, gold marks the keys that landed on the beat and the
  // rest turn neutral. Without one, every key is gold.
  const weight = kind === 'enter' || kind === 'space' ? 1 : kind === 'back' ? 0.72 : 0.86;
  const fresh = scopeEls[scopeCursor];
  scopeCursor = (scopeCursor + 1) % scopeEls.length;
  fresh.style.order = String(scopeOrder++);
  fresh.style.height = `${8 + weight * 36 + (inTime ? 6 : 0)}px`;
  fresh.style.opacity = String(inTime ? 1 : 0.45 + weight * 0.45);
  fresh.style.background = inTime === false ? 'var(--muted)' : '';

  const idx = (sensor.events.length * 7) % barEls.length;
  const bar = barEls[idx];
  bar.style.height = `${10 + weight * 20}px`;
  bar.style.background = 'var(--live)';
  bar.style.opacity = '1';
  clearTimeout(bar._reset);
  bar._reset = setTimeout(() => {
    bar.style.height = '3px';
    bar.style.background = '';
    bar.style.opacity = '';
  }, 300);
}

player.onNote = (note) => {
  const idx = Math.min(barEls.length - 1, Math.max(0,
    Math.round(((note.midi - 24) / 66) * (barEls.length - 1))));
  const bar = barEls[idx];
  bar.style.height = `${7 + note.vel * 23}px`;
  bar.style.background = 'var(--live)';
  clearTimeout(bar._reset);
  bar._reset = setTimeout(() => { bar.style.height = '3px'; bar.style.background = ''; }, 250);
};

/**
 * The song position the listener is hearing now. The deck reports what is
 * being rendered, which reaches the speakers only after the output latency.
 */
function heardPosition() {
  const ctx = piano.ctx;
  return deck.position - ((ctx?.outputLatency || 0) + (ctx?.baseLatency || 0));
}

// Global and window-local keyboard events enter through the same privacy boundary.
function handleKind(kind) {
  if (!enabled || !KEY_KINDS.has(kind)) return;
  sensor.push(kind);

  const stems = isPlaying && deck?.playing && mixer && touch;
  const heard = stems ? heardPosition() : null;
  const inTime = stems && mixer.beats ? mixer.beats.inTime(heard) : null;
  animateInput(kind, inTime);

  if (!isPlaying) return;
  if (stems) {
    touch.hit({ accent: kind === 'space' || kind === 'enter', inTime: Boolean(inTime) });
    mixer.strike(performance.now() / 1000, kind, heard);
    return;
  }
  if (backing?.playing) {
    if (soloist) {
      const midi = soloist.strike(backing.scorePosition, arranger.intensity);
      if (midi !== null) {
        player.onNote({ midi, vel: 0.72, layer: 'melody' });
        backing.duck(0.25 + arranger.intensity * 0.25);
        clearTimeout(unduckTimer);
        unduckTimer = setTimeout(() => backing.duck(0), 600);
      }
    }
    return;
  }
  player.strike();
}

if (desktop?.isDesktop) {
  desktop.onKey(({ kind }) => handleKind(kind));
} else {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('button, input, [contenteditable="true"]')) return;
    let kind = null;
    if (event.key === 'Backspace' || event.key === 'Delete') kind = 'back';
    else if (event.key === 'Enter') kind = 'enter';
    else if (event.key === ' ') kind = 'space';
    else if (event.key.length === 1) kind = 'char';
    if (kind) handleKind(kind);
  });
}

function updatePowerUi() {
  el.app.dataset.enabled = String(enabled);
  el.app.dataset.playing = String(isPlaying);
  el.power.setAttribute('aria-pressed', String(enabled));
  el.playPause.dataset.icon = isPlaying ? 'pause' : 'play';
  el.playPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  el.playPause.title = isPlaying ? 'Pause' : 'Play';

  if (isLoading) {
    el.statusText.textContent = 'Loading';
    el.powerHeadline.textContent = current ? `Loading ${current.title}` : 'Preparing music';
    el.powerHint.textContent = 'The first decode may take a moment';
    return;
  }

  if (enabled) {
    // "Listening" rather than "Paused": pausing the music does not stop the
    // keyboard hook, and that distinction is the app's central privacy promise.
    el.statusText.textContent = isPlaying ? 'Live' : 'Listening';
    el.powerHeadline.textContent = isPlaying ? 'Type anywhere' : 'Music paused';
    el.powerHint.textContent = isPlaying
      ? 'Keysong follows your rhythm in the background'
      : 'Keyboard monitoring remains enabled';
    el.powerLabel.textContent = 'Disable';
  } else {
    el.statusText.textContent = 'Idle';
    el.powerHeadline.textContent = 'Let your keyboard drive the music';
    el.powerHint.textContent = desktop?.isDesktop
      ? 'Enable, switch to any app, and start typing'
      : 'Browser preview responds only to this page';
    el.powerLabel.textContent = 'Enable';
  }
}

function setLoading(value) {
  isLoading = value;
  el.power.disabled = value;
  el.playPause.disabled = value;
  el.next.disabled = value;
  updatePowerUi();
}

function playbackPosition() {
  if (currentEngine === 'stems' && deck) return Math.max(0, deck.position - stemStartOffset);
  if (currentEngine === 'audio' && backing) return backing.position;
  if (currentEngine === 'midi') return player.position;
  return 0;
}

function playbackDuration() {
  if (currentEngine === 'stems' && deck) return Math.max(0, deck.duration - stemStartOffset);
  if (currentEngine === 'audio' && backing) return backing.duration;
  if (currentEngine === 'midi') return player.duration;
  return 0;
}

function updateProgress() {
  const pos = playbackPosition();
  const duration = playbackDuration();
  const pct = duration > 0 ? Math.min(100, Math.max(0, (pos / duration) * 100)) : 0;
  el.trackProgress.style.width = `${pct}%`;
  el.trackTime.textContent = formatTime(pos);
  el.trackDuration.textContent = formatTime(duration);
}

async function ensureAudio() {
  await piano.init(() => {});
  if (output) return;
  // The one place the whole app meets the speakers, so volume is one gain.
  output = piano.ctx.createGain();
  output.gain.value = volumeGain(volume);
  output.connect(piano.ctx.destination);
  piano.connect(output);
  piano.setVolume(volumeGain(volume));
}

/** Perceived loudness follows the square of the slider, not the slider itself. */
const volumeGain = (percent) => (percent / 100) ** 2;

function setVolume(percent, { save = true } = {}) {
  volume = Math.min(100, Math.max(0, Math.round(percent)));
  el.volume.value = String(volume);
  el.volumeValue.textContent = `${volume}%`;
  el.volume.style.setProperty('--fill', `${volume}%`);
  if (output) {
    output.gain.setTargetAtTime(volumeGain(volume), output.context.currentTime, 0.02);
    piano.setVolume(volumeGain(volume));
  }
  if (save) localStorage.setItem('keysong:volume', String(volume));
}

function setClicks(on, { save = true } = {}) {
  clicks = on;
  el.clicks.checked = on;
  if (touch) touch.enabled = on;
  if (save) localStorage.setItem('keysong:clicks', on ? 'on' : 'off');
}

function stopCurrent() {
  if (deck) deck.stop();
  if (backing) backing.stop();
  player.stop();
  isPlaying = false;
}

function pausePlayback() {
  if (deck?.playing) deck.pause();
  if (backing?.playing) backing.pause();
  if (player.playing) player.pause();
  isPlaying = false;
  updatePowerUi();
}

async function resumePlayback() {
  if (!current) {
    if (!queue.length) return;
    current = queue[0];
  }
  if (loadedItemId !== current.id) {
    await loadTrack(current, { autoplay: true });
    return;
  }

  await ensureAudio();
  if (currentEngine === 'stems' && deck) {
    deck.play(Math.max(deck.position, stemStartOffset));
    startFrameLoop();
  } else if (currentEngine === 'audio' && backing) await backing.play();
  else if (currentEngine === 'midi') player.resume();
  isPlaying = true;
  updatePowerUi();
}

/**
 * Pick the stem that typing reveals: the listener's remembered choice when this
 * track can honour it, otherwise the first mode the stem set supports.
 */
function followStemMode(roles) {
  const modes = availableModes(roles);
  if (!modes.length) return 'vocal';
  return modes.includes(stemMode) ? stemMode : modes[0];
}

function applyStemMode(mode) {
  stemMode = mode;
  localStorage.setItem('keysong:stemMode', mode);
  if (mixer) mixer.setMode(mode);
  renderMixer();
  // A different stem is a different performance.
  if (analysis) startTake();
}

/* ------------------------------------------------------ performance feedback */

/** The presence lane of the stem the current mode reveals, once analysed. */
function revealedLane() {
  if (!analysis || !mixer || !deck) return null;
  const [role] = foregroundRoles(mixer.mode, deck.roles);
  return (role && analysis.lanes[role]) || null;
}

/** Begin a new take of the revealed stem from wherever playback is now. */
function startTake() {
  const lane = revealedLane();
  take = lane ? new Take(lane, { start: stemStartOffset }) : null;
  takeBest = take && current ? bestTakes.get(bestKey(current, mixer.mode)) : null;
  songMap.show(take, { start: stemStartOffset, end: deck?.duration ?? 0 });
  el.rail.hidden = Boolean(take);
  renderScore();
}

/** Forget the feedback state of the previous track. */
function clearFeedback() {
  analysisToken++;
  analysis = null;
  take = null;
  takeBest = null;
  lastBeatIndex = -1;
  songMap.show(null);
  el.rail.hidden = false;
  renderScore();
}

/**
 * Analyse the loaded stems in the background, then switch on the feedback
 * that depends on it. Until then the stems already follow typing as before.
 */
function startAnalysis(item) {
  const token = ++analysisToken;
  const cached = analysisCache.get(item.id);
  const job = cached ? Promise.resolve(cached) : analyzeStems(deck.buffers);
  job.then((result) => {
    if (!cached) {
      analysisCache.set(item.id, result);
      if (analysisCache.size > 24) analysisCache.delete(analysisCache.keys().next().value);
    }
    if (token !== analysisToken || !mixer) return;
    analysis = result;
    mixer.setBeatGrid(result.beats);
    lastBeatIndex = -1;
    startTake();
  }).catch((error) => console.warn('[feedback] Analysis failed; stems still follow typing.', error));
}

const bestKey = (item, mode) => `${item.id}|${mode}`;
const percent = (share) => `${Math.round(share * 100)}%`;

function renderScore() {
  el.scoreRead.hidden = !take;
  if (!take) return;
  el.scoreLabel.textContent = MODES[mixer.mode].scoreLabel;
  const { score } = take;
  el.scoreValue.textContent = score === null ? '—' : percent(score);
  el.scoreBest.textContent = takeBest === null ? '' : `best ${percent(takeBest)}`;
}

/**
 * Say what the revealed stem is doing: sounding because of the typing,
 * waiting for it, or resting in a break where typing cannot be heard.
 */
function renderStemStatus(pos, open) {
  if (!take) {
    setSourceTag(open ? 'Following' : 'Backing');
    return;
  }
  const mode = MODES[mixer.mode];
  const { phrase, next } = take.moment(pos);
  const state = phrase
    ? (open ? 'on' : 'cue')
    : (next && next.start - pos <= CUE_LEAD ? 'cue' : 'break');
  setSourceTag({ on: mode.playing, cue: 'Your cue', break: 'Break' }[state], state);

  if (state === 'break') {
    const noun = `${mode.noun[0].toUpperCase()}${mode.noun.slice(1)}`;
    setHint(next ? `${noun} in ${formatTime(Math.ceil(next.start - pos))}` : `No more ${mode.noun} in this track`);
  } else if (state === 'cue' && !open) {
    setHint(`Type now to bring the ${mode.noun} in`);
  } else {
    setHint(stemModeHint(mixer.mode, deck.roles));
  }
}

/** When a track plays out, report the take and keep it if it is a best. */
function finishTake() {
  if (!take?.complete || !current || !mixer) return;
  const mode = MODES[mixer.mode];
  const { score } = take;
  const result = bestTakes.submit(bestKey(current, mixer.mode), score);
  takeBest = result.best;
  const parts = [`You ${mode.verb} ${percent(score)} of the ${mode.noun}`];
  if (result.improved && result.previous !== null) parts.push('a new best');
  else if (!result.improved) parts.push(`best ${percent(result.best)}`);
  if (take.longestRun >= 10) parts.push(`longest run ${formatTime(take.longestRun)}`);
  showToast(parts.join(' · '), 6000);
  renderList();
}

/**
 * Visuals that must follow the music closely: the song map's playhead and
 * the beat ring. The loop runs only while stems play, and the browser
 * suspends it whenever the window is hidden.
 */
function startFrameLoop() {
  if (!frameRequest) frameRequest = requestAnimationFrame(frame);
}

function frame(now) {
  frameRequest = 0;
  if (currentEngine !== 'stems' || !deck?.playing) {
    songMap.draw(deck?.position ?? 0);
    return;
  }
  frameRequest = requestAnimationFrame(frame);

  // The playhead crosses a pixel every half second or so; ten redraws a
  // second keep it and the gold paint smooth.
  if (take && now - lastMapDraw > 100) {
    lastMapDraw = now;
    songMap.draw(deck.position);
  }

  const grid = mixer?.beats;
  if (!grid) return;
  const heard = heardPosition();
  const index = grid.indexAt(heard);
  if (index === lastBeatIndex) return;
  // Pulse for a beat just crossed, never for one jumped past.
  if (index > lastBeatIndex && index >= 0 && heard - grid.times[index] < 0.1) pulseBeat(grid.period);
  lastBeatIndex = index;
}

const formatRoleList = (roles) => (roles.length < 2
  ? (roles[0] ?? '')
  : `${roles.slice(0, -1).join(', ')} and ${roles.at(-1)}`);

/** Describe the mix in the listener's terms: what responds, and what always plays. */
function stemModeHint(mode, roles) {
  const foreground = MODES[mode]?.foreground.filter((r) => roles.includes(r)) ?? [];
  const reveals = formatRoleList(foreground) || (MODES[mode]?.short ?? mode).toLowerCase();
  const rest = roles.filter((r) => !foreground.includes(r));
  if (!rest.length) return `Typing reveals ${reveals}.`;

  // Name the anchor first: it is the part that never stops, whatever you type.
  const ordered = rest.includes(ANCHOR_ROLE)
    ? [ANCHOR_ROLE, ...rest.filter((r) => r !== ANCHOR_ROLE)]
    : rest;
  const listed = formatRoleList(ordered);
  const sentence = `${listed[0].toUpperCase()}${listed.slice(1)}`;
  return `Typing reveals ${reveals}. ${sentence} ${ordered.length === 1 ? 'keeps' : 'keep'} playing.`;
}

const ROLE_LABEL = {
  vocals: 'Vocals', instrumental: 'Backing', drums: 'Drums', bass: 'Bass', other: 'Other',
};

/** Which mode, if any, reveals this role. */
function modeForRole(role, roles) {
  return availableModes(roles).find((mode) => MODES[mode].foreground.includes(role)) ?? null;
}

/** Meter elements, keyed by role, so the level loop never queries the DOM. */
let meterEls = new Map();

/**
 * Rebuild the mixer for whatever the loaded track contains.
 *
 * Every stem gets a row, not just the selectable ones: showing the whole mix is
 * what makes the mechanism legible. Rows that some mode can reveal are
 * clickable; the rest are labelled as the bed they are.
 */
function renderMixer() {
  const roles = currentEngine === 'stems' && deck ? deck.roles : [];
  el.mixer.hidden = roles.length === 0;
  // The spectrum belongs to the MIDI and audio engines. With nothing loaded it
  // is a row of inert dashes, so it stays hidden until a track is actually on.
  el.bars.hidden = roles.length > 0 || !currentEngine;
  meterEls = new Map();
  if (el.mixer.hidden) {
    el.mixerRows.replaceChildren();
    return;
  }

  const active = mixer?.mode ?? followStemMode(roles);
  const fragment = document.createDocumentFragment();
  for (const role of roles) {
    const mode = modeForRole(role, roles);
    const selected = mode !== null && mode === active;
    const anchor = role === ANCHOR_ROLE;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'stem-row';
    row.dataset.role = role;
    row.dataset.selectable = String(mode !== null);
    row.dataset.anchor = String(anchor);
    if (mode) {
      row.dataset.mode = mode;
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', String(selected));
      row.title = MODES[mode].hint;
    } else {
      row.disabled = true;
      row.title = 'This stem plays continuously on this track.';
    }

    const name = document.createElement('span');
    name.className = 'stem-name';
    name.textContent = ROLE_LABEL[role] ?? role;

    const meter = document.createElement('span');
    meter.className = 'stem-meter';
    const fill = document.createElement('i');
    meter.appendChild(fill);
    meterEls.set(role, fill);

    const tag = document.createElement('span');
    tag.className = 'stem-tag';
    tag.textContent = selected ? 'Typing' : anchor ? 'Always' : 'Playing';

    row.append(name, meter, tag);
    fragment.appendChild(row);
  }
  el.mixerRows.replaceChildren(fragment);
}

/** Drive the meters from the gains the mixer actually applied. */
function updateMeters() {
  if (!deck || el.mixer.hidden) return;
  for (const [role, fill] of meterEls) {
    const gain = deck.stems.get(role)?.gain.gain.value ?? 0;
    fill.style.transform = `scaleX(${Math.min(1, gain).toFixed(3)})`;
  }
}

el.mixerRows.addEventListener('click', (event) => {
  const mode = event.target?.closest?.('.stem-row')?.dataset.mode;
  if (!mode || mode === mixer?.mode) return;
  applyStemMode(mode);
  el.npComposer.textContent = stemModeHint(mode, deck?.roles ?? []);
});

/**
 * Measure the key of an audio file already in memory.
 *
 * The full-length PCM is released as soon as the band-limited analysis slice
 * exists, so a long track does not leave a hundred megabytes of Float32
 * resident while the FFT runs.
 */
async function analyzeKey(bytes) {
  let buffer = await piano.ctx.decodeAudioData(bytes);
  const samples = await toAnalysisSamples(buffer);
  buffer = null;
  return detectKeyAsync({ sampleRate: ANALYSIS_RATE, samples });
}

async function loadTrack(item, { autoplay = true } = {}) {
  if (!item || isLoading) return;
  current = item;
  setLoading(true);
  el.npTitle.textContent = item.title;
  el.npComposer.textContent = 'Preparing…';
  setSourceTag('Loading');
  clearFeedback();
  updateListSelection();

  try {
    await ensureAudio();
    stopCurrent();
    // Release whatever the previous engine was holding. Decoded stems alone can
    // be well over 100 MB, and nothing frees them if the deck is only stopped.
    if (deck && !hasStems(item)) { deck.unload(); mixer = null; }
    if (backing && !item.audioUrl) backing.unload();
    current = item;
    loadedItemId = null;
    currentEngine = null;
    stemStartOffset = 0;
    updateProgress();   // Clear the last track's progress while this one loads.
    renderMixer();   // Hidden until we know the new track carries stems.

    // Give the browser one frame to paint the loading state. Decoding a large
    // MIDI blocks this thread inside @tonejs/midi, so without this yield the
    // window freezes before the message the freeze is meant to explain appears.
    if (item.get) {
      el.npComposer.textContent = 'Reading score…';
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const piece = await library.load(item);

    if (hasStems(item)) {
      currentEngine = 'stems';
      deck = deck || new StemDeck(piano.ctx, output);
      if (!touch) {
        touch = new Touch(piano.ctx, output);
        touch.enabled = clicks;
      }
      if (item.demo) {
        el.npComposer.textContent = 'Composing the demo…';
        deck.loadDecoded(await renderDemo(piano.ctx.sampleRate));
      } else {
        const roles = Object.keys(item.stemUrls);
        // Fetch every stem at once; the decode inside deck.load() also overlaps.
        let fetched = 0;
        const buffers = Object.fromEntries(await Promise.all(roles.map(async (role) => {
          const response = await fetch(item.stemUrls[role]);
          if (!response.ok) throw new Error(`Stem loading failed: ${response.status}`);
          const data = await response.arrayBuffer();
          el.npComposer.textContent = `Loaded stem ${++fetched}/${roles.length}`;
          return [role, data];
        })));
        await deck.load(buffers, (progress) => {
          el.npComposer.textContent = `Decoding ${Math.round(progress * 100)}%`;
        });
      }
      mixer = new Mixer(deck);
      mixer.setRefRate(refRate);
      mixer.setMode(followStemMode(deck.roles));
      deck.onEnded = () => {
        finishTake();
        handleTrackEnded();
      };
      stemStartOffset = deck.audibleStart();
      renderMixer();
      el.npComposer.textContent = stemModeHint(mixer.mode, deck.roles);
      setSourceTag(item.demo ? 'Demo' : 'Typing stems');
      if (autoplay) deck.play(stemStartOffset);
      startAnalysis(item);
      startFrameLoop();
    } else if (item.audioUrl) {
      currentEngine = 'audio';
      backing = backing || new Backing(piano.ctx, output);
      soloist = soloist || new Soloist(piano);
      piano.ensureSampler();   // This engine performs on the piano, so pay for it now.
      el.npComposer.textContent = 'Loading audio…';

      if (piece) {
        await backing.load(item.audioUrl);
        soloist.fromMidi(piece);
        backing.offset = 0;
        el.npComposer.textContent = 'Original backing — Typing releases melody';
      } else {
        // No score to follow, so the key has to be measured. One read feeds both
        // the player and the analyser instead of transferring the file twice.
        const response = await fetch(item.audioUrl);
        if (!response.ok) throw new Error(`Audio reading failed: ${response.status}`);
        const bytes = await response.arrayBuffer();
        // Blob construction copies, so decoding may detach `bytes` afterwards.
        await backing.load(URL.createObjectURL(new Blob([bytes])), { revokeOnUnload: true });
        el.npComposer.textContent = 'Detecting key…';
        const key = await analyzeKey(bytes);
        soloist.fromKey(key.tonic, key.mode);
        el.npComposer.textContent = `${key.name} — Typing releases melody`;
      }
      backing.onEnded = () => handleTrackEnded();
      setSourceTag('Audio');
      if (autoplay) await backing.play();
    } else {
      if (!piece) throw new Error('This track has no playable content');
      currentEngine = 'midi';
      soloist = null;
      piano.ensureSampler();
      player.mode = 'hybrid';
      player.load(piece);
      el.npComposer.textContent = `${Math.round(piece.bpm)} BPM — Typing releases ornament notes`;
      setSourceTag('MIDI');
      if (autoplay) player.start();
    }

    loadedItemId = item.id;
    isPlaying = autoplay;
    el.trackDuration.textContent = formatTime(playbackDuration());
    updateListSelection();
  } catch (error) {
    stopCurrent();
    reportError(error);
  } finally {
    setLoading(false);
    updateProgress();
  }
}

/** Shuffle consumes a shuffled deck, so every track plays before any repeats. */
function nextItem() {
  if (!queue.length) return null;
  if (!current) return queue[0];
  const index = Math.max(0, queue.findIndex((item) => item.id === current.id));
  if (orderMode !== 'shuffle' || queue.length < 2) return queue[(index + 1) % queue.length];

  const live = new Set(queue.map((item) => item.id));
  shuffleDeck = shuffleDeck.filter((id) => live.has(id) && id !== current.id);
  if (!shuffleDeck.length) {
    shuffleDeck = queue.map((item) => item.id).filter((id) => id !== current.id);
    for (let i = shuffleDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffleDeck[i], shuffleDeck[j]] = [shuffleDeck[j], shuffleDeck[i]];
    }
  }
  const nextId = shuffleDeck.shift();
  return queue.find((item) => item.id === nextId) ?? queue[(index + 1) % queue.length];
}

function showStandby(item) {
  current = item;
  loadedItemId = null;
  clearFeedback();
  el.npTitle.textContent = item.title;
  el.npComposer.textContent = 'Enable to play';
  setSourceTag('Standby');
  updateListSelection();
}

async function nextTrack({ autoplay = isPlaying } = {}) {
  const item = nextItem();
  if (!item) return;
  if (!enabled) {
    showStandby(item);
    updateProgress();
    return;
  }
  await loadTrack(item, { autoplay });
}

function handleTrackEnded() {
  isPlaying = false;
  nextTrack({ autoplay: true }).catch(reportError);
}

player.onPieceEnd = handleTrackEnded;

async function setEnabled(next) {
  if (isLoading || next === enabled) return;
  el.power.disabled = true;
  powerTransition = true;
  try {
    if (next) {
      // Unlock WebAudio inside the button gesture before awaiting any IPC call.
      await ensureAudio();
      if (desktop?.isDesktop) {
        const state = await desktop.setEnabled(true);
        if (!state?.supported || !state?.enabled) {
          throw new Error(state?.error || 'Windows global keyboard monitoring could not start');
        }
      }
      enabled = true;
      updatePowerUi();
      await resumePlayback();
    } else {
      pausePlayback();
      if (desktop?.isDesktop) await desktop.setEnabled(false);
      enabled = false;
      updatePowerUi();
    }
  } catch (error) {
    enabled = false;
    pausePlayback();
    reportError(error);
  } finally {
    powerTransition = false;
    el.power.disabled = false;
    updatePowerUi();
  }
}

function renderOrder() {
  const shuffle = orderMode === 'shuffle';
  el.orderLabel.textContent = shuffle ? 'Shuffle' : 'Sequence';
  el.order.dataset.icon = shuffle ? 'shuffle' : 'sequence';
  el.order.title = shuffle ? 'Shuffle playback' : 'Sequence playback';
  el.order.setAttribute('aria-label', shuffle ? 'Shuffle playback' : 'Sequence playback');
}

/** Selection changes far more often than the playlist does, so it moves alone. */
function updateListSelection() {
  for (const li of el.list.children) {
    li.classList.toggle('on', li.dataset.id === current?.id);
  }
}

function renderList() {
  el.list.replaceChildren();
  // Until the listener adds music of their own, say how, under the demo.
  el.emptyLibrary.hidden = queue.some((item) => !item.demo);
  const fragment = document.createDocumentFragment();
  queue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = item.id === current?.id ? 'on' : '';
    li.dataset.id = item.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `Play ${item.title}`);

    const number = document.createElement('span');
    number.className = 'track-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span');
    copy.className = 'list-copy';
    const name = document.createElement('b');
    name.textContent = item.title;
    const source = document.createElement('small');
    if (hasStems(item)) source.append(...stemsLabel(item));
    else source.textContent = item.audioUrl ? 'Audio' : 'MIDI';
    copy.append(name, source);
    const state = document.createElement('span');
    state.className = 'list-state';
    li.append(number, copy, state);
    fragment.appendChild(li);
  });
  el.list.appendChild(fragment);
}

/** What kind of entry this is, plus the best take on the stem it would reveal. */
function stemsLabel(item) {
  const kind = item.demo ? 'Built-in demo' : 'Typing stems';
  const best = bestTakes.get(bestKey(item, followStemMode(stemRoles(item))));
  if (best === null) return [kind];
  const badge = document.createElement('em');
  badge.className = 'best';
  badge.textContent = `Best ${percent(best)}`;
  return [kind, badge];
}

function chooseFromList(target) {
  const li = target?.closest?.('li');
  if (!li || isLoading) return;
  const item = queue.find((entry) => entry.id === li.dataset.id);
  if (!item) return;
  // Choosing the track that is already loaded must not decode it all over again.
  if (item.id === loadedItemId) {
    if (enabled && !isPlaying) resumePlayback().catch(reportError);
    return;
  }
  if (!enabled) showStandby(item);
  else loadTrack(item, { autoplay: isPlaying }).catch(reportError);
}

// A mouse click leaves focus on whatever it pressed, and the next Space or
// Enter typed into this window presses it again: typing straight after
// clicking Enable switched monitoring off at the first space, and after
// clicking a track, reloaded it at every one. Pointer clicks let go of focus;
// keyboard activation, which reports no click count, keeps it.
document.addEventListener('click', (event) => {
  if (event.detail === 0) return;
  event.target.closest?.('button, input, [tabindex]')?.blur();
});

// One delegated pair of listeners instead of two per track.
el.list.addEventListener('click', (event) => chooseFromList(event.target));
el.list.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  chooseFromList(event.target);
});

function reportError(error) {
  console.error(error);
  el.npComposer.textContent = error?.message || 'An unknown error occurred';
  setSourceTag('Error');
  showToast(error?.message || 'The operation failed');
}

el.power.addEventListener('click', () => setEnabled(!enabled));
el.playPause.addEventListener('click', async () => {
  if (isLoading) return;
  if (!enabled) {
    await setEnabled(true);
  } else if (isPlaying) {
    pausePlayback();
  } else {
    await resumePlayback();
  }
});
el.next.addEventListener('click', () => nextTrack({ autoplay: isPlaying }).catch(reportError));
el.order.addEventListener('click', () => {
  orderMode = orderMode === 'sequence' ? 'shuffle' : 'sequence';
  shuffleDeck = [];
  localStorage.setItem('keysong:order', orderMode);
  renderOrder();
  showToast(orderMode === 'shuffle' ? 'Shuffle playback enabled' : 'Sequence playback enabled');
});

// ------------------------------------------------------------------ sound

setVolume(volume, { save: false });
setClicks(clicks, { save: false });

function setSoundPanel(open) {
  el.soundPanel.hidden = !open;
  el.soundButton.setAttribute('aria-expanded', String(open));
}

/** A control set with the mouse lets go of focus, so typing cannot change it. */
const releaseIfPointer = (input) => {
  if (!input.matches(':focus-visible')) input.blur();
};

el.soundButton.addEventListener('click', () => setSoundPanel(el.soundPanel.hidden));
el.volume.addEventListener('input', () => setVolume(Number(el.volume.value)));
el.volume.addEventListener('change', () => releaseIfPointer(el.volume));
el.clicks.addEventListener('change', () => {
  setClicks(el.clicks.checked);
  releaseIfPointer(el.clicks);
});
document.addEventListener('pointerdown', (event) => {
  if (!el.soundPanel.hidden && !event.target.closest?.('.sound-wrap')) setSoundPanel(false);
});

// ---------------------------------------------------------------- mini mode

let mini = false;
const appHeight = () => Math.ceil(el.app.getBoundingClientRect().height);

/**
 * Shrink to a small always-on-top player, so the song map and cues stay in
 * view while the typing happens in another app. The compact layout goes in
 * first, then the window is fitted to its height.
 */
async function setMiniMode(on) {
  mini = on;
  setSoundPanel(false);
  document.body.classList.toggle('mini', on);
  const label = on ? 'Full window' : 'Mini player';
  el.miniButton.dataset.icon = on ? 'full' : 'mini';
  el.miniButton.title = label;
  el.miniButton.setAttribute('aria-label', label);
  el.miniButton.setAttribute('aria-pressed', String(on));
  if (!desktop?.setMini) return;
  try {
    await desktop.setMini(on, on ? appHeight() : 0);
  } catch (error) {
    reportError(error);
  }
}

el.miniButton.addEventListener('click', () => setMiniMode(!mini));

// The compact layout changes height when, say, the hint wraps or the score
// appears; keep the window fitted to it.
new ResizeObserver(() => {
  if (mini && desktop?.setMini) desktop.setMini(true, appHeight()).catch(reportError);
}).observe(el.app);

// ------------------------------------------------------------------ seeking

/** The stretch of the track the timeline spans, when the engine can jump in it. */
function seekRange() {
  if (currentEngine === 'stems' && deck?.duration) return { start: stemStartOffset, end: deck.duration };
  if (currentEngine === 'audio' && backing?.el && backing.duration) return { start: 0, end: backing.duration };
  return null;
}

function secondsAtPointer(event) {
  const range = seekRange();
  if (!range) return null;
  const rect = el.scrub.getBoundingClientRect();
  const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return { seconds: range.start + share * (range.end - range.start), x: share * rect.width, width: rect.width };
}

el.scrub.addEventListener('click', (event) => {
  const point = secondsAtPointer(event);
  if (!point) return;
  if (currentEngine === 'stems') {
    deck.seek(point.seconds);
    // The beat ring resumes from here instead of pulsing for every beat skipped.
    if (mixer?.beats) lastBeatIndex = mixer.beats.indexAt(point.seconds);
    songMap.draw(deck.position);
  } else {
    backing.seek(point.seconds);
  }
  updateProgress();
});

el.scrub.addEventListener('pointermove', (event) => {
  const point = secondsAtPointer(event);
  el.scrub.dataset.seekable = String(Boolean(point));
  el.seekTip.hidden = !point;
  if (!point) return;
  const offset = currentEngine === 'stems' ? stemStartOffset : 0;
  el.seekTip.textContent = formatTime(point.seconds - offset);
  el.seekTip.style.left = `${Math.min(point.width - 18, Math.max(18, point.x))}px`;
});
el.scrub.addEventListener('pointerleave', () => { el.seekTip.hidden = true; });

el.emptyLibraryAction.addEventListener('click', () => $('pickDir').click());

$('importHelpButton').addEventListener('click', () => {
  const wrap = $('importHelpButton').closest('.help-wrap');
  const open = !wrap.classList.contains('open');
  wrap.classList.toggle('open', open);
  $('importHelpButton').setAttribute('aria-expanded', String(open));
});

const helpWrap = $('importHelpButton').closest('.help-wrap');
helpWrap.addEventListener('mouseenter', () => $('importHelpButton').setAttribute('aria-expanded', 'true'));
helpWrap.addEventListener('mouseleave', () => {
  if (!helpWrap.classList.contains('open')) $('importHelpButton').setAttribute('aria-expanded', 'false');
});
helpWrap.addEventListener('focusin', () => $('importHelpButton').setAttribute('aria-expanded', 'true'));
helpWrap.addEventListener('focusout', (event) => {
  if (!helpWrap.contains(event.relatedTarget) && !helpWrap.classList.contains('open')) {
    $('importHelpButton').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  helpWrap.classList.remove('open');
  $('importHelpButton').setAttribute('aria-expanded', 'false');
  setSoundPanel(false);
});

$('pickDir').addEventListener('click', async () => {
  try {
    if (desktop?.openMusicResource) {
      const result = await desktop.openMusicResource();
      if (!result?.ok) throw new Error(result?.error || 'Music Resources could not be opened');
      showToast('Music Resources opened — New songs refresh automatically');
      return;
    }
    if (!library.supportsFolder) {
      $('folderInput').click();
      return;
    }
    const result = library.needsPermission ? await library.regrant() : await library.pickFolder();
    if (!result) return;
    showToast(result.count
      ? `Added ${result.count} track${result.count === 1 ? '' : 's'} from ${result.name}`
      : 'No supported music was found in the folder');
  } catch (error) {
    if (error.name !== 'AbortError') reportError(error);
  }
});

$('folderInput').addEventListener('change', async (event) => {
  const count = await library.addFiles(event.target.files);
  showToast(count ? `Added ${count} track${count === 1 ? '' : 's'}` : 'No supported music files were found');
  event.target.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  if (++dragDepth === 1) el.dropzone.classList.add('on');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; el.dropzone.classList.remove('on'); }
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  el.dropzone.classList.remove('on');
  const count = await library.addFiles(event.dataTransfer.files);
  showToast(count ? `Added ${count} track${count === 1 ? '' : 's'}` : 'No supported music files were found');
});

// Update musical state at 15 Hz; progress and automatic speed calibration run
// less often. The loop idles out once nothing is enabled, playing, or still
// decaying, so a disabled window costs nothing.
let lastTick = performance.now() / 1000;
setInterval(() => {
  const now = performance.now() / 1000;
  const features = sensor.features(now);

  // Keep ticking briefly past the last key so gates and bars finish their decay.
  if (!enabled && !isPlaying && features.idle > 5) {
    lastTick = now;
    return;
  }

  const dt = now - lastTick;
  lastTick = now;
  arranger.update(features, dt);

  if (deck?.playing && mixer) {
    const mix = mixer.update(now, dt, features.rate);
    // Recorded here rather than per frame: the typist is usually in another
    // window, where frames stop but this loop keeps running.
    const pos = deck.position;
    take?.record(pos, mix.fg);
    renderStemStatus(pos, mix.fg > 0.04);
  } else if (isPlaying && currentEngine === 'midi') {
    player.syncTempo();
  }

  if (now - lastUiTick > 0.18) {
    lastUiTick = now;
    el.stRate.textContent = features.rate.toFixed(1);
    updateProgress();
    updateMeters();
    renderScore();
    const newest = (scopeCursor + scopeEls.length - 1) % scopeEls.length;
    for (let i = 0; i < scopeEls.length; i++) {
      if (i === newest) continue;
      const bar = scopeEls[i];
      const height = Number.parseFloat(bar.style.height || '3');
      bar.style.height = `${Math.max(3, height * 0.82)}px`;
      bar.style.opacity = String(Math.max(0.16, Number(bar.style.opacity || 0.2) * 0.9));
    }
  }

  if (now - lastRateTune > 2) {
    lastRateTune = now;
    const typical = sensor.typicalRate();
    if (typical) {
      const target = Math.min(9, Math.max(1.2, typical));
      const next = refRate * 0.82 + target * 0.18;
      // The smoothing converges but never settles exactly, so persist only on a
      // change actually worth a synchronous disk write.
      if (Math.abs(next - refRate) > 0.05) localStorage.setItem('keysong:refRate', next.toFixed(2));
      refRate = next;
      if (mixer) mixer.setRefRate(refRate);
    }
  }
}, 66);

library.onChange = () => {
  // The demo always sits below the listener's own music.
  queue = [...library.items.filter((item) => !item.demo), ...library.items.filter((item) => item.demo)];
  // A song on standby whose files were removed gives way to the first song left.
  if (current && current.id !== loadedItemId && !isLoading && !queue.some((item) => item.id === current.id)) {
    if (queue.length) showStandby(queue[0]);
    else current = null;
  }
  if (current) current = queue.find((item) => item.id === current.id) || current;
  if (!current && queue.length) current = queue[0];
  shuffleDeck = [];
  // A rescan may carry replaced files under an unchanged name.
  analysisCache.clear();
  renderList();
};

function applyMusicResource(payload, notify = false) {
  if (!payload) return 0;
  if (!libraryReady) {
    pendingMusicResource = payload;
    return 0;
  }
  const count = library.setResourceFiles(payload.files || []);
  if (payload.error) showToast(`Music Resources could not be read: ${payload.error}`);
  else if (notify) showToast(`Music Resources refreshed — ${count} track${count === 1 ? '' : 's'}`);
  return count;
}

renderOrder();
renderMixer();   // Nothing is loaded yet, so this hides both the mixer and the spectrum.
updatePowerUi();
library.init().then(async () => {
  libraryReady = true;
  if (desktop?.getMusicResource) {
    const payload = pendingMusicResource || await desktop.getMusicResource();
    pendingMusicResource = null;
    applyMusicResource(payload);
  }
  if (!queue.length) return;
  current = current || queue[0];
  el.npTitle.textContent = current.title;
  el.npComposer.textContent = 'Enable to play';
  setSourceTag('Standby');
  updateListSelection();
}).catch(reportError);

if (desktop?.isDesktop) {
  desktop.onMusicResourceChange((payload) => applyMusicResource(payload, true));
  desktop.getState().then((state) => {
    if (!state?.supported) {
      el.platformLabel.textContent = 'Global monitoring unavailable';
      showToast(state?.error || 'Windows global keyboard monitoring is unavailable');
    }
  }).catch(reportError);

  // The main process broadcasts state on every change. Without this the UI keeps
  // claiming input is enabled after a hook that failed once it was already
  // running. Transitions we started ourselves are already reflected in the UI.
  desktop.onState?.((state) => {
    if (!state || powerTransition) return;
    if (!state.supported) el.platformLabel.textContent = 'Global monitoring unavailable';
    if (enabled && !state.enabled) {
      enabled = false;
      pausePlayback();
      updatePowerUi();
      showToast(state.error || 'Global keyboard monitoring stopped');
    }
  });
}

if (import.meta.env.DEV) {
  window.__keysong = {
    piano, sensor, arranger, player, library, Tone,
    get enabled() { return enabled; },
    get isPlaying() { return isPlaying; },
    get backing() { return backing; },
    get deck() { return deck; },
    get mixer() { return mixer; },
    get analysis() { return analysis; },
    get take() { return take; },
    handleKind,
  };
}
