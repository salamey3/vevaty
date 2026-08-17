import base64
import glob
import mimetypes
import os
import re
import shutil

DIST = "dist"

html_path = os.path.join(DIST, "index.html")
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

# Expo doesn't always emit exactly one web bundle. Alongside the entry
# bundle it code-splits dynamically-imported modules into their own chunks --
# right now that's expo-camera's ZXing barcode scanner, which nothing in
# src/ ever invokes (the camera is used for photo capture only). The old
# `assert len(js_files) == 1` turned the mere existence of such a chunk into
# a hard build failure, which is why this script stopped working.
#
# Pick the *entry* bundle the same way the browser does -- by reading the
# <script src> out of index.html -- rather than assuming there's only one
# file in the directory, and report any remaining chunks instead of dying on
# them.
entry_match = re.search(r'<script src="(/_expo/static/js/web/[^"]+)"[^>]*></script>', html)
assert entry_match, "could not find the entry <script src> in dist/index.html"
js_path = os.path.join(DIST, entry_match.group(1).lstrip("/"))
_extra_chunks = [
    p for p in sorted(glob.glob(os.path.join(DIST, "_expo", "static", "js", "web", "*.js")))
    if os.path.abspath(p) != os.path.abspath(js_path)
]
if _extra_chunks:
    print(f"NOTE: {len(_extra_chunks)} lazily-loaded chunk(s) are not inlined into the single-file build:")
    for p in _extra_chunks:
        print(f"  - {os.path.basename(p)} ({os.path.getsize(p)} bytes)")
    print("  They are only fetched if the app dynamically imports them at runtime.")
    print("  Nothing in src/ does today. If that ever changes, upload dist/_expo/ next to index.html.")
with open(js_path, "r", encoding="utf-8") as f:
    js = f.read()

# Inline every /assets/... reference found in the JS bundle as a data: URI.
asset_refs = sorted(set(re.findall(r'/assets/[^"\'\\]+', js)))
print(f"Found {len(asset_refs)} unique asset refs")
for ref in asset_refs:
    local_path = os.path.join(DIST, ref.lstrip("/"))
    if not os.path.exists(local_path):
        print(f"  MISSING: {local_path}")
        continue
    mime, _ = mimetypes.guess_type(local_path)
    mime = mime or "application/octet-stream"
    with open(local_path, "rb") as af:
        b64 = base64.b64encode(af.read()).decode("ascii")
    data_uri = f"data:{mime};base64,{b64}"
    js = js.replace(ref, lambda_safe := data_uri) if False else re.sub(re.escape(ref), lambda m, d=data_uri: d, js)

# Inline favicon too.
favicon_path = os.path.join(DIST, "favicon.ico")
if os.path.exists(favicon_path):
    with open(favicon_path, "rb") as f:
        favicon_b64 = base64.b64encode(f.read()).decode("ascii")
    favicon_data_uri = f"data:image/x-icon;base64,{favicon_b64}"
    html = re.sub(r'href="/favicon\.ico"', lambda m, d=favicon_data_uri: f'href="{d}"', html)

# Replace the external <script src="..."> with an inline <script> containing the bundle.
script_pattern = re.compile(r'<script src="/_expo/static/js/web/[^"]+" defer></script>')
match = script_pattern.search(html)
assert match, "could not find script tag to inline"
html = script_pattern.sub(lambda m, j=js: f"<script>{j}</script>", html, count=1)

# Repo-relative, not /tmp. Termux -- where the real builds actually run --
# has no writable /tmp, so the old hardcoded "/tmp/vevaty-app-standalone.html"
# made this script die on the phone before writing anything. dist/ is
# gitignored, so this never ends up committed. Override with
# STANDALONE_OUT=/some/path to put the copy elsewhere.
out_path = os.environ.get("STANDALONE_OUT", os.path.join(DIST, "vevaty-standalone.html"))
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)

print(f"Wrote {out_path} ({os.path.getsize(out_path)} bytes)")

# IMPORTANT: also overwrite dist/index.html with this same fully self-contained
# bundle. The raw dist/index.html that `expo export` produces references an
# external script (/_expo/static/js/web/index-*.js) that is NOT part of our
# manual cPanel deploy (we only ever upload index.html + this standalone file,
# never the whole _expo/ asset tree). If the raw shell is ever uploaded as
# index.html, every direct/deep-link request -- including plain "/" -- gets
# served that shell, the browser 404s fetching the missing script, our SPA-
# fallback .htaccess rewrites that 404 to index.html's *HTML*, and the
# resulting "Unexpected token '<'" JS parse error leaves a blank white page.
# Making dist/index.html byte-identical to the standalone build means
# whichever of the two gets uploaded as "index.html", it just works.
dist_index_path = os.path.join(DIST, "index.html")
with open(dist_index_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"Overwrote {dist_index_path} with the self-contained bundle ({os.path.getsize(dist_index_path)} bytes)")

# Carry the SPA-fallback .htaccess into dist/ on every build, so a manual
# cPanel upload of dist/'s contents always includes it -- this is what
# fixes the 404-on-refresh bug (Apache otherwise 404s on any client-side
# route like /profile or /admin/categories since no real file exists at
# that path).
htaccess_src = ".htaccess"
if os.path.exists(htaccess_src):
    shutil.copyfile(htaccess_src, os.path.join(DIST, ".htaccess"))
    print(f"Copied {htaccess_src} -> {os.path.join(DIST, '.htaccess')}")
else:
    print(f"WARNING: {htaccess_src} not found -- dist/ will be missing the SPA-fallback rewrite rule")
