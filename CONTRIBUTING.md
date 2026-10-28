# Contributing

Keep changes focused and explain the behavior they improve. Reuse the existing components before adding another abstraction. First-party contributions use the project's Unlicense; third-party modifications retain their original licenses and attribution.

## Code style

Run `npm run format` and `npm run lint` in `scene` for JavaScript, HTML, project scripts, and workflows. Run `.\gradlew.bat spotlessApply` at the root for Kotlin and Gradle scripts. CI checks the same pinned tools. Vendor files are excluded from automatic reformatting so upstream changes remain reviewable.

Keep camera configuration in the shared settings, UI strings in Android resources, and frequent rendering/input paths free of avoidable allocations. Prefer small functions with one responsibility. Add a framework or layer only when it solves an actual problem in this app.

## Verify changes

1. Install locked Node dependencies with `npm ci` in `scene`.
2. Run `npm run lint`, `npm run format:check`, and `npm test`.
3. Rebuild changed scene code with `npm run build`, then run `npm run check:bundle`.
4. Run `npm run test:browser` after installing Playwright Chromium.
5. Run `.\gradlew.bat spotlessCheck assembleDebug lintDebug` and relevant native tests.

On macOS/Linux, substitute `bash ./gradlew`. For native layouts, run `connectedDebugAndroidTest`. For WebView/lifecycle changes, also run the emulator smoke script:

```powershell
$env:ADB = "$env:ANDROID_HOME/platform-tools/adb.exe"
$env:ANDROID_SERIAL = "emulator-5554"
node scripts/android-smoke.mjs
```

Install the current debug APK on that emulator first. The script deliberately exercises renderer failure and retry, so it refuses physical phones. Set SMOKE_OUTPUT_DIR to save screenshots.

## Dependencies and publication

Dependencies are pinned. IslandControls adapts internal hooks in the pinned Three.js OrbitControls implementation. Upgrades must pass pointer-order, cancellation, pinch, twist, tilt, and browser tests. Record vendored Ultra-Water edits in scene/vendor/ultra-water/CHANGES.md and retain its license.

Update README, DESIGN, TODO, verification notes, and affected license notices before preparing distribution artifacts. Include source and generated assets together. Never commit SDK paths, signing keys, caches, or credentials. The public demo is a development build; a store release needs its own signing and release review.
