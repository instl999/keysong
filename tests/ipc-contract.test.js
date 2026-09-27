import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The main process, the preload bridge, and the renderer agree on channel and
 * scheme names only by spelling them the same way. Nothing fails at build time
 * when they drift apart; the desktop app just stops responding. These checks
 * read the sources directly, so they run without Electron.
 */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, preload, renderer] = await Promise.all([
  read('electron/main.cjs'),
  read('electron/preload.cjs'),
  read('src/main.js'),
]);

const captures = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);

test('every channel the preload invokes has a handler in the main process', () => {
  const invoked = captures(preload, /ipcRenderer\.invoke\('([^']+)'/g);
  const handled = new Set(captures(main, /ipcMain\.handle\('([^']+)'/g));
  assert.ok(invoked.length > 0, 'the preload should invoke at least one channel');
  for (const channel of invoked) assert.ok(handled.has(channel), `${channel} has no ipcMain.handle`);
});

test('every channel the preload listens on is sent by the main process', () => {
  const listened = captures(preload, /ipcRenderer\.on\('([^']+)'/g);
  const sent = new Set(captures(main, /webContents\.send\('([^']+)'/g));
  assert.ok(listened.length > 0, 'the preload should listen on at least one channel');
  for (const channel of listened) assert.ok(sent.has(channel), `${channel} is never sent`);
});

test('the renderer reads the bridge that the preload exposes', () => {
  const [exposed] = captures(preload, /exposeInMainWorld\('([^']+)'/g);
  assert.ok(exposed, 'the preload should expose a bridge');
  assert.match(renderer, new RegExp(`window\\.${exposed}\\b`));
});

test('the media scheme is registered, handled, and emitted under one name', () => {
  const [registered] = captures(main, /scheme: '([^']+)'/g);
  const [handled] = captures(main, /protocol\.handle\('([^']+)'/g);
  const [emitted] = captures(main, /`([a-z-]+):\/\/file\//g);
  assert.ok(registered, 'a privileged scheme should be registered');
  assert.equal(handled, registered);
  assert.equal(emitted, registered);
});

test('the key channel carries only the allow-listed category', () => {
  // The privacy boundary: raw key codes stay in the main process.
  const sends = [...main.matchAll(/webContents\.send\('[^']+:key', ([^)]*)\)/g)];
  assert.equal(sends.length, 1, 'keys should leave the main process in exactly one place');
  assert.equal(sends[0][1].trim(), '{ kind }');
});
