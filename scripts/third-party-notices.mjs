// Write Keysong's license and those of every package that ships inside the app.
//
// The production bundle strips license comments, so without this file the
// portable build would carry MIT and Apache-licensed code without the notices
// those licenses require. The list comes from package-lock.json: every package
// not marked dev-only is bundled into the renderer or packed into the app.
//
// Usage: node scripts/third-party-notices.mjs <output directory>...
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;
const RULE = `\n\n${'-'.repeat(78)}\n\n`;

const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/**
 * Some packages declare a license in package.json but publish no license
 * file. For MIT, reconstruct the notice from the declared author.
 */
async function declaredNotice(dir, license) {
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  const source = manifest.homepage || manifest.repository?.url || manifest.repository;
  const origin = source ? `\nSource: ${source}` : '';
  if (license === 'MIT' && author) return `MIT License\n\nCopyright (c) ${author}\n\n${MIT_TERMS}${origin}`;
  return `(The package includes no license file.)${origin}`;
}

export async function thirdPartyNotices(root) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const shipped = Object.entries(lock.packages)
    .filter(([path, meta]) => path.startsWith('node_modules/') && !meta.dev && !meta.devOptional)
    .sort(([a], [b]) => a.localeCompare(b, 'en'));

  const sections = [];
  for (const [path, meta] of shipped) {
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const dir = join(root, path);
    const files = (await readdir(dir)).filter((file) => LICENSE_FILE.test(file)).sort();
    const texts = await Promise.all(files.map((file) => readFile(join(dir, file), 'utf8')));
    const body = texts.map((text) => text.trim()).join('\n\n') || await declaredNotice(dir, meta.license);
    sections.push(`${name} ${meta.version}\nLicense: ${meta.license ?? 'see below'}\n\n${body}`);
  }

  const own = (await readFile(join(root, 'LICENSE'), 'utf8')).trim();
  const header = [
    `Keysong is distributed under the following license.\n\n${own}`,
    'Keysong includes the following third-party software. Each package is\ndistributed under the license reproduced with it.',
  ].join(RULE);
  return `${header}${RULE}${sections.join(RULE)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const targets = process.argv.slice(2);
  if (!targets.length) throw new Error('Name at least one output directory.');
  const notices = await thirdPartyNotices(root);
  for (const target of targets) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'THIRD-PARTY-NOTICES.txt'), notices, 'utf8');
    console.log(`  [notices] ${resolve(target, 'THIRD-PARTY-NOTICES.txt')}`);
  }
}
