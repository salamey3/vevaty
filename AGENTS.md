# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Branding

See @BRANDING.md before touching any logo, icon, colour token, typeface or
brand asset. It is the source of truth and the assets are generated from
it — do not hand-edit a PNG in `assets/`, change the spec and regenerate.

# Do not add npm scripts casually

`@expo/fingerprint` hashes package.json's **`scripts`** block into the
runtime version (source: `packageJson:scripts`). Over-the-air updates only
reach an installed app whose runtime matches, so adding one line to
`scripts` orphans every future update: `eas update` reports success, the
update appears in `eas update:list`, and no phone ever asks for that
runtime.

This has already happened once. `"test:upload"` was added, the fingerprint
went from `b3a56e8f…` to `e97b364d…`, and the app sat frozen on an old
bundle through six ships while the website updated correctly every time —
which made it look, repeatedly, like the code was wrong rather than
undelivered.

- Dev-only tooling: run it directly (`node scripts/…`), not via an npm script.
- If a script genuinely must exist, a new native build is required before
  any update reaches existing installs.
- `npm run ship` checks this now and says so loudly. It did not before: it
  passed `--non-interactive` to `eas-cli`, which that CLI rejects, so the
  check threw and printed "skipped" every time. A diagnostic that cannot
  run must never report like one that ran and passed.

devDependencies themselves are fine — `esbuild` and `sharp` are not
autolinked and do not move the fingerprint. It is the `scripts` block.
