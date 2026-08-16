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

js_files = glob.glob(os.path.join(DIST, "_expo", "static", "js", "web", "*.js"))
assert len(js_files) == 1, js_files
js_path = js_files[0]
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

out_path = "/tmp/vevaty-app-standalone.html"
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
