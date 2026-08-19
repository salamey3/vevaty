// Tests photo upload's retry behaviour against the REAL src/lib/photoUpload.ts.
//
//   npm run test:upload
//
// The module can't be imported directly under Node -- it pulls in
// expo-file-system and react-native -- so esbuild bundles it first with
// ONLY those native/UI dependencies stubbed. The retry loop under test is
// therefore the shipped code, not a copy of it that can drift.
//
// Why this exists: a real phone posting three photos uploaded the first,
// then hit "Unable to resolve host vevaty.com" on the next two and
// published the listing with nothing to show. Upload gave up after ONE
// attempt on any network failure, so a single dropped lookup cost the
// seller that photo permanently.
//
// Photos have since moved off vevaty.com onto Bunny edge storage via the
// upload-photo function, which is the actual cure for that particular
// host being unreachable. The retry loop stays and stays tested: mobile
// connections in Lebanon drop packets whatever the destination is.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'photoUpload.test.mjs');

const stub = (name, contents) => ({
  name: `stub-${name}`,
  setup(build) {
    const esc = name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
    build.onResolve({ filter: new RegExp(`^${esc}$`) }, (a) => ({ path: a.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => (a.path === name ? { contents, loader: 'js' } : undefined));
  },
});

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/photoUpload.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
  plugins: [
    stub('react-native', `export const Platform = { OS: 'web' };`),
    stub('expo-file-system', `
      export class File { constructor(u){ this.u = u; } async upload(){ return globalThis.__NATIVE_UPLOAD__(this.u); } }
      export const UploadType = { MULTIPART: 'multipart', BINARY_CONTENT: 'binary' };`),
    stub('./imageToBase64', `export async function resizePhotoForUpload(u){ return u; }`),
    stub('./supabase', `
      export const SUPABASE_URL = 'https://project.supabase.co';
      export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
      export const supabase = {
        auth: { getSession: async () => ({ data: { session: globalThis.__SESSION__ } }) },
      };`),
    stub('./alertShim', `export const Alert = { alert: (t, m) => { (globalThis.__ALERTS__ ||= []).push({ t, m }); } };`),
  ],
});

const { uploadPhotos } = await import(OUT);

let calls = 0;
const reset = () => {
  calls = 0;
  globalThis.__ALERTS__ = [];
  globalThis.__SESSION__ = { access_token: 'fake-jwt' };
};

// The web path calls fetch TWICE per photo: once to read the local file
// into a Blob, then once to POST it. Only the POST is scripted; the local
// read always succeeds, exactly as it does on a device.
const isUpload = (url) => typeof url === 'string' && url.includes('upload-photo');
const localFile = { blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) };
const DNS_ERROR = 'Unable to resolve host "project.supabase.co": No address associated with hostname';

function scriptedFetch(script) {
  return async (url) => {
    if (!isUpload(url)) return localFile;
    const step = script[Math.min(calls, script.length - 1)];
    calls++;
    if (step === 'DNS') throw new Error(DNS_ERROR);
    if (typeof step === 'number') return { status: step, text: async () => `{"error":"http ${step}"}` };
    return { status: 200, text: async () => '{"url":"https://vevaty-media.b-cdn.net/listings/ok.jpg"}' };
  };
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// 1. The reported bug: DNS drops once, then the network comes back.
reset(); globalThis.fetch = scriptedFetch(['DNS', 'OK']);
let urls = await uploadPhotos(['file:///a.jpg']);
check('recovers after one DNS failure', urls.length === 1 && calls === 2, `urls=${urls.length} attempts=${calls}`);
check('  ...and shows no error dialog', globalThis.__ALERTS__.length === 0);

// 2. Flaky twice, succeeds on the third.
reset(); globalThis.fetch = scriptedFetch(['DNS', 'DNS', 'OK']);
urls = await uploadPhotos(['file:///a.jpg']);
check('recovers on the third attempt', urls.length === 1 && calls === 3, `attempts=${calls}`);

// 3. Genuinely offline: give up, and say so usefully.
reset(); globalThis.fetch = scriptedFetch(['DNS']);
urls = await uploadPhotos(['file:///a.jpg']);
check('gives up after 3 attempts', urls.length === 0 && calls === 3, `attempts=${calls}`);
check('  ...and does alert the seller', globalThis.__ALERTS__.length === 1);
check('  ...with actionable copy (mentions Edit)', /Edit/.test(globalThis.__ALERTS__[0]?.m || ''));

// 4. A server-side error is worth another go.
reset(); globalThis.fetch = scriptedFetch([500, 'OK']);
urls = await uploadPhotos(['file:///a.jpg']);
check('retries a 5xx', urls.length === 1 && calls === 2, `attempts=${calls}`);

// 5. A refusal the server meant must NOT be retried -- same answer every
//    time, so retrying only delays the error.
reset(); globalThis.fetch = scriptedFetch([400]);
urls = await uploadPhotos(['file:///a.jpg']);
check('does NOT retry a 400', urls.length === 0 && calls === 1, `attempts=${calls}`);

// 6. A 403 is now the seller's session, not an expired ticket -- the
//    server will say the same thing every time, so don't spend attempts.
reset(); globalThis.fetch = scriptedFetch([403]);
urls = await uploadPhotos(['file:///a.jpg']);
check('does NOT retry a 403', urls.length === 0 && calls === 1, `attempts=${calls}`);

// 6b. Signed out entirely: fail immediately with copy that says why,
//     rather than three rounds of a request that cannot be authorised.
reset(); globalThis.__SESSION__ = null; globalThis.fetch = scriptedFetch(['OK']);
urls = await uploadPhotos(['file:///a.jpg']);
check('fails fast when signed out', urls.length === 0 && calls === 0, `attempts=${calls}`);
check('  ...and says so', /signed out/i.test(globalThis.__ALERTS__[0]?.m || ''),
      globalThis.__ALERTS__[0]?.m || '(no alert)');

// 7. The exact shape reported from the phone: three photos, one blip.
reset();
let n = 0;
globalThis.fetch = async (url) => {
  if (!isUpload(url)) return localFile;
  n++;
  if (n === 2) throw new Error(DNS_ERROR);
  return { status: 200, text: async () => '{"url":"https://vevaty-media.b-cdn.net/listings/ok.jpg"}' };
};
urls = await uploadPhotos(['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg']);
check('all 3 photos survive one mid-flight blip', urls.length === 3, `uploaded=${urls.length}/3`);
check('  ...with no error dialog', globalThis.__ALERTS__.length === 0);

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);
process.exit(allOk ? 0 : 1);
