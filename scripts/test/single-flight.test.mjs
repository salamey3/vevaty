// The launch refresh runs once, and once more for whoever asked during it.
//
//   node scripts/test/single-flight.test.mjs
//
// Run directly, NOT via an npm script -- see upload-retry.test.mjs's own
// comment for why (@expo/fingerprint + package.json's "scripts" block).
//
// What this protects: SettingsStore's first-mount effect and the auth
// listener's INITIAL_SESSION both ask for a settings refresh in the same
// tick. Side by side they fetched four tables twice and ran two admin
// checks that overlap -- and if the newer check's read fails while the
// older's succeeded, the answer that wins is "not an admin", so an admin
// reloading an admin page gets the sign-in form over a good session.
//
// The distinction the tests below exist to hold: QUEUED, not dropped. A
// plain mutex would also make the duplicate go away, and would be wrong --
// the second caller may know about a sign-in that landed mid-fetch.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'singleFlight.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/singleFlight.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
});
const { singleFlight } = await import(OUT);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// A run we can hold open, so "while one is in flight" is a real state and
// not a timing accident.
function holdable() {
  let runs = 0;
  let release = () => {};
  const run = () => {
    runs += 1;
    return new Promise((res) => { release = res; });
  };
  return { run, release: () => release(), get runs() { return runs; } };
}
const settle = () => new Promise((r) => setImmediate(r));

// 1. THE LAUNCH CASE. Two callers in the same tick.
{
  const h = holdable();
  const request = singleFlight(h.run);
  request();
  request();
  await settle();
  check('two callers in one tick start ONE run', h.runs === 1, String(h.runs));
  h.release();
  await settle(); await settle();
  check('  ...and the second gets its own run afterwards', h.runs === 2, String(h.runs));
  h.release();
  await settle(); await settle();
  check('  ...then it stops', h.runs === 2, String(h.runs));
}

// 2. A burst collapses into exactly one re-run, not one per caller.
{
  const h = holdable();
  const request = singleFlight(h.run);
  for (let i = 0; i < 10; i++) request();
  await settle();
  check('ten callers start one run', h.runs === 1, String(h.runs));
  h.release();
  await settle(); await settle();
  check('  ...and cost exactly one re-run, not ten', h.runs === 2, String(h.runs));
}

// 3. Nobody asked during the run, so there is no re-run.
{
  const h = holdable();
  const request = singleFlight(h.run);
  request();
  await settle();
  h.release();
  await settle(); await settle();
  check('one caller alone runs once', h.runs === 1, String(h.runs));
}

// 4. Sequential callers each get their own run -- the queue must not
//    suppress a request that arrives when nothing is happening.
{
  const h = holdable();
  const request = singleFlight(h.run);
  request(); await settle(); h.release(); await settle(); await settle();
  request(); await settle(); h.release(); await settle(); await settle();
  check('two callers well apart run twice', h.runs === 2, String(h.runs));
}

// 5. A caller arriving mid-flight is handed the run ALREADY GOING.
//    Documented rather than incidental: it is why SettingsStore's admin
//    save paths do not use this -- they must see their own write.
{
  const h = holdable();
  const request = singleFlight(h.run);
  const first = request();
  const second = request();
  check('a mid-flight caller gets the in-flight promise, not the re-run',
    first === second);
  h.release();
  await settle(); await settle();
  h.release();
  await settle();
}

// 6. A THROWN run must not wedge the queue shut. Without the finally,
//    one failed refresh would mean no launch refresh ever again.
{
  let runs = 0;
  const request = singleFlight(async () => { runs += 1; throw new Error('network'); });
  await request().catch(() => {});
  await settle();
  await request().catch(() => {});
  await settle();
  check('a failed run does not wedge it shut', runs === 2, String(runs));
}

// 7. And a failure still honours a request that arrived during it.
{
  let runs = 0;
  let release = () => {};
  const request = singleFlight(() => {
    runs += 1;
    return new Promise((_res, rej) => { release = () => rej(new Error('network')); });
  });
  request().catch(() => {});
  request().catch(() => {});
  await settle();
  check('a failing run still starts one', runs === 1, String(runs));
  release();
  await settle(); await settle();
  check('  ...and the queued request still runs after it fails', runs === 2, String(runs));

  // The re-run is started internally, so nobody is awaiting it. Rejecting
  // it must not produce an unhandled rejection -- a red box in dev over a
  // refresh whose failure is already survivable. Caught here rather than
  // asserted, because an unhandled one kills the process and the failure
  // would read as a crash rather than as this check.
  let unhandled = null;
  process.once('unhandledRejection', (e) => { unhandled = e; });
  release();
  await settle(); await settle();
  check('a rejected re-run is not left unhandled', unhandled === null,
    unhandled ? String(unhandled) : '');
}

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log();
console.log(allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
