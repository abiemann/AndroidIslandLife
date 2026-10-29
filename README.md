# Island Life

A small Android island scene with a Jetpack Compose interface and animated sea from [Ultra-Water](https://github.com/Humpalumps/Ultra-Water).

Drag one finger to pan, pinch to zoom, twist two fingers to turn the island, or move both fingers up/down to tilt. Pause the waves, switch daylight/golden light, or recenter the view. **Storm**, immediately left of **Recenter**, brings rough seas with larger waves and an overcast atmosphere; the button then becomes **Sun**, which restores calm water and your chosen daylight/golden lighting. Tap the FPS counter at the top right to choose **30 FPS**, **60 FPS**, or **Unlocked**. Unlocked is the default; your choice is saved between launches. Rocks sit among the trees, leaving the beach clear.

## Architecture

Ultra-Water is a Three.js/WebGL2 renderer. Compose owns the native controls and lifecycle; an AndroidView hosts the bundled renderer in an offline WebView using Android's [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content). The APK includes all scene code and geometry and requests no internet permission. This is a hybrid rendering app, not a Kotlin port of Ultra-Water.

The app reuses Ultra-Water's waves, shore foam, wet sand, caustics, reflections, and atmosphere. It adds deterministic instanced vegetation, touch controls, lifecycle handling, and mobile rendering limits. Scene composition, frame scheduling, and gesture handling have separate responsibilities. See [DESIGN.md](DESIGN.md) for boundaries and [VERIFICATION.md](VERIFICATION.md) for checked behavior and remaining limits.

For a close view of the waves, pan over the sea first, then pinch in and drag both fingers up to lower the viewing angle. The camera can approach within 5 scene units of its focus and tilt to 1° above horizontal, placing the closest/lowest view about 9cm above mean sea level. Navigation is unrestricted by trees or terrain; the camera no longer rises over treetops automatically. Nearby wave crests can pass above the view.

Unlocked rendering submits a frame on every available display callback; capped modes pace animation and touch redraws together. Rendering retains its 1.1 million pixel budget. The counter measures submitted scene frames, not display refresh rate or GPU throughput. Actual speed depends on the GPU, WebView, and Android's display, battery, and thermal policies; a selected limit is not a guaranteed frame rate.

## Build the demo

Use Android Studio or JDK 21, Android SDK Platform 36.1, and Build Tools 36.0.0. The wrapper pins Gradle 9.6.0 and verifies its download checksum. First builds need network access for development dependencies; the installed app does not.

Open the folder in Android Studio and let it configure the SDK, or set ANDROID_HOME for a command-line build. Then run:

```powershell
.\gradlew.bat assembleDebug
```

On macOS/Linux, use `bash ./gradlew assembleDebug`.

The APK is `app/build/outputs/apk/debug/app-debug.apk`. It is a **debug demo**, with development debugging enabled and a development signature, suitable for source review and testing. It is not a Play Store release. Builds on different machines use different debug signing keys and may require uninstalling an older demo. No release signing key is included.

Prebuilt scene assets are included, so Node is unnecessary for an Android-only build. After editing scene code, use Node 24:

```powershell
cd scene
npm ci
npm run lint
npm run format:check
npm test
npm run build
npm run check:bundle
cd ..
.\gradlew.bat spotlessCheck assembleDebug lintDebug
```

The bundle check rebuilds into a temporary directory and compares every asset without overwriting the current bundle. Include rebuilt assets when sharing scene changes. CI rejects stale bundles.

## Tests and development

- `npm run dev` in `scene` starts a localhost renderer preview. Native controls appear only in Android.
- `npm test` checks frame pacing, scheduling, and gestures.
- `npx playwright install chromium` then `npm run test:browser` in `scene` checks the offline production bundle. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use an existing Chromium installation.
- Linux browser checks use software graphics at quarter-scale raster resolution while retaining the full scene, CSS viewport, and real touch events. Set PLAYWRIGHT_SOFTWARE_RENDERING=1 to reproduce that mode elsewhere. The smoke test logs each phase, saves evidence under `scene/test-results/browser-smoke`, and fails after twelve minutes if the browser stalls.
- `.\gradlew.bat connectedDebugAndroidTest` checks native large-text layouts on an emulator or test device.
- `scripts/android-smoke.mjs` exercises the actual WebView, lifecycle, blocked requests, and renderer recovery. It requires ADB and an explicit emulator ANDROID_SERIAL and refuses physical devices.

The [CI workflow](.github/workflows/verify.yml) checks formatting, JavaScript lint, unit tests, bundle freshness, Android build/lint, browser rendering, and native layout tests. Compilation runs before the graphics smoke; browser evidence is retained even on failure. See [CONTRIBUTING.md](CONTRIBUTING.md) for the editing workflow.

## Compatibility and scope

Android 8.0/API 26 or newer is required, with a WebView supporting WebGL2, floating-point rendering/filtering, and multisampled half-float render targets. Unsupported hardware displays a retry/help state. An Android version alone does not guarantee GPU compatibility.

This is a visual demo with no networking, accounts, analytics, audio, or saved gameplay. Native labels and buttons support accessibility services; the 3D scene is primarily gesture-driven and is not a fully nonvisual experience. Sustained thermal/battery measurements and broader device coverage remain open work in [TODO.md](TODO.md).

## Reuse and credits

Island Life's original code uses the [Unlicense](LICENSE): you may use, modify, distribute, or sell it, including in closed-source projects, without attribution. The [full terms](https://unlicense.org/) include a warranty disclaimer.

This dedication does **not** replace third-party licenses. Ultra-Water and Three.js retain MIT licenses; AndroidX, Kotlin, coroutines, and the Gradle wrapper retain Apache 2.0 terms. Preserve their notices when redistributing them. See [third-party notices](scene/public/THIRD_PARTY_NOTICES.txt) and [vendored changes](scene/vendor/ultra-water/CHANGES.md). License texts are also bundled in the APK.

Exclude local.properties, caches, IDE settings, node_modules, build directories, signing keys, and logs from public source archives. These are development-machine files, not project source.
