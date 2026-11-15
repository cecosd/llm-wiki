// npm test: runs the tests from tests/ and writes a readable report for the "Settings" page and the product page.
//   npm test                 writes outputs/test-results.json (only on this computer)
//   npm test -- --publish    also writes docs/test-results.json (the report that ships with the release)
// The tests work in a temporary folder with a fake claude: they do not touch the library and spend no tokens.
// Test name: "group|English|Български". Reason for todo: "English :: Български".
import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import { ROOT, OUTPUTS } from './lib.js';
import { versionInfo, checkPackages } from './updates.js';

const TESTS = path.join(ROOT, 'tests');
const publish = process.argv.includes('--publish');

const scrub = (s) => String(s || '').split(ROOT).join('.').replace(/(?:\/tmp|\/var\/folders|[A-Za-z]:\\[^\s'"]*Temp)[^\s'"]*/g, '<temp>').slice(0, 400);
const split2 = (s) => { const [en, bg] = String(s || '').split(' :: '); return { en: en || '', bg: bg || en || '' }; };

const files = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(TESTS, f));
const tests = [];
const crashes = [];

function record(ev, data) {
  if (data.details?.type === 'suite') return;
  const parts = String(data.name).split('|');
  const error = data.details?.error;
  const failed = ev === 'fail' || !!error;
  if (parts.length !== 3) {
    // A file that did not start at all counts as a failure: otherwise the problem stays invisible.
    if (failed && !data.todo) crashes.push(scrub(error?.cause?.message || error?.message || data.name));
    return;
  }
  const [group, en, bg] = parts;
  let status = 'pass';
  if (data.skip !== undefined) status = 'not_run';
  else if (failed) status = data.todo !== undefined ? 'known' : 'fail';
  const note = status === 'known' ? split2(data.todo) : status === 'not_run' ? split2(data.skip) : null;
  tests.push({ group, en, bg, status, ...(note ? { note } : {}), ...(status === 'fail' ? { error: scrub(error?.cause?.message || error?.message) } : {}) });
}

const started = Date.now();
await new Promise((resolve) => {
  const stream = run({ files, concurrency: false, timeout: 180000 });
  stream.on('test:pass', (d) => record('pass', d));
  stream.on('test:fail', (d) => record('fail', d));
  stream.on('end', resolve);
  stream.on('close', resolve);
  stream.resume?.();
});

if (crashes.length) crashes.forEach((c) => tests.push({ group: 'runner', en: 'A test file could not run', bg: 'Файл с тестове не успя да се изпълни', status: 'fail', error: c }));

const count = (s) => tests.filter((t) => t.status === s).length;
const notCovered = JSON.parse(fs.readFileSync(path.join(TESTS, 'not-covered.json'), 'utf8'));
const groups = JSON.parse(fs.readFileSync(path.join(TESTS, 'groups.json'), 'utf8'));
let packages = null;
try {
  const p = await checkPackages();
  packages = { outdated: p.outdated.ok ? p.outdated.items : null, audit: p.audit.ok ? { total: p.audit.total, critical: p.audit.critical, high: p.audit.high, moderate: p.audit.moderate, low: p.audit.low } : null };
} catch { /* without internet the report simply has no such section */ }

const report = {
  version: versionInfo().version,
  date: new Date().toISOString(),
  durationMs: Date.now() - started,
  environment: { platform: process.platform, node: process.versions.node },
  summary: { total: tests.length, pass: count('pass'), fail: count('fail'), known: count('known'), notRun: count('not_run'), notCovered: notCovered.length },
  groups,
  tests,
  notCovered,
  packages,
};

fs.mkdirSync(OUTPUTS, { recursive: true });
const body = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(OUTPUTS, 'test-results.json'), body);
if (publish) fs.writeFileSync(path.join(ROOT, 'docs', 'test-results.json'), body);

const icon = { pass: 'ok  ', fail: 'FAIL', known: 'KNOWN', not_run: 'skip' };
for (const t of tests) console.log(`${icon[t.status]} [${t.group}] ${t.en}${t.error ? `\n     ${t.error}` : ''}`);
const s = report.summary;
console.log(`\n${s.pass} passed, ${s.fail} failed, ${s.known} known issues, ${s.notRun} not run, ${s.notCovered} areas not covered by automatic tests.`);
process.exit(s.fail ? 1 : 0);
