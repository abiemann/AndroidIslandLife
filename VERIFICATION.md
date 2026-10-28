# Verification — 2026-10-28

## Build

- `npm ci` dependencies installed from pinned versions; `npm run build` successfully generated bundled assets.
- Gradle 9.6.0 / AGP 9.4.1: `assembleDebug` and `lintDebug` passed.
- Lint has no errors. Update advisories remain for the intentionally pinned Android SDK and dependency versions.
- The merged Android manifest does not request INTERNET access.
- Ultra-Water and Three.js license notices are included in the source and APK assets.

## Browser renderer

Tested the production HTML/JavaScript with all requests restricted to its bundled local origin. Ready fired once; no JavaScript failures or WebGL errors were observed. Portrait 616×1371 rendering ran near the 30 FPS target for 30 seconds on the development machine's GPU. This is not a phone performance measurement.

Confirmed that pause freezes simulation time and reports zero FPS, background suspension leaves no animation callback pending, and resume restarts animation. Lighting changes and touch-style orbit/recenter worked; landscape resizing kept the island at the camera target. Inspected both lighting modes, removed a visible deep-seabed boundary, and verified the mobile camera's improved shoreline depth precision.

## Android app

Installed the debug APK in a Pixel 7-profile Android 36.1 emulator using hardware graphics. Verified:

- Offline asset loading and visible island/water scene.
- Native FPS label at the top right, updating around 29–30 FPS on this emulator.
- Native Pause/Play, including `0 FPS` and unchanged simulation time when paused.
- Native daylight/golden-light switching while paused.
- Touch orbit and native recenter.
- Background/foreground suspension and resumption.
- Portrait/landscape rotation, with pause and lighting state restored after the new scene initializes.
- Portrait and landscape screenshots visually reviewed.

The emulator initially exposed a collapsed WebView viewport; explicit match-parent layout dimensions fixed it. Browser-only testing would not have caught this.

## Zoom and touch update — 2026-10-28

Expanded minimum zoom distance from 70% of the overview distance to a fixed 250m, over seven times closer in portrait. Automated two-finger touch events reached the new limit; the same limit was checked in landscape. Verified that one-finger dragging translates the camera/focus without rotation, two-finger dragging rotates around the panned focus, and Recenter restores the original overview. Ground-plane panning preserves focus height. Geometry measurements put the lowest camera/near-plane heights at 153.89m/136.40m, above the 96.05m canopy maximum. No JavaScript errors were observed during these checks.

## Maps-style rotation update — 2026-10-28

Changed two-finger rotation to use the angle between the fingers: a clockwise 45° twist produces a clockwise 45° island turn without changing viewing tilt or zoom. Dragging both fingers down/up still changes tilt in both directions without changing bearing. The real multi-touch browser checks also confirmed one-finger panning, the 250m pinch limit in portrait/landscape, and Recenter. No JavaScript errors were observed. Tilt is computed from the gesture's starting angle and midpoint so separately delivered finger movements do not accumulate unwanted tilt at its limits.

All 11 `npm test` regression cases passed, covering clockwise/counterclockwise turns, ±180° wrapping, both pointer delivery orders, tilt limits, the 250m pinch limit, and combined twist/tilt/pinch. The tests are saved in `scene/tests/IslandControls.test.js` for future Three.js upgrades.

## Additional close zoom — 2026-10-28

Reduced the minimum camera distance from 250m to 225m, allowing 10% closer zoom. All 11 gesture regression tests passed with the new limit, and real multi-touch browser checks reached 225m in portrait and landscape while preserving twist, up/down tilt, pan, and Recenter. The lowest camera height is 140.00m and the lowest near-plane corner is 122.51m, leaving 26.46m above the highest canopy.

## Second close-zoom adjustment — 2026-10-28

Reduced the minimum camera distance from 225m to 202.5m, another 10% closer. All 11 gesture regression cases and bundled-scene multi-touch checks passed at the new portrait/landscape limit. The lowest camera height is 127.50m and the lowest near-plane corner is 110.01m, retaining 13.96m of clearance above the highest canopy.

## Inland rocks update — 2026-10-28

Moved all 90 rock instances from the shoreline to locations near actual broadleaf trees. Placement was deterministic across two scene constructions. Every rock center is within 17.67m of a tree; terrain beneath all transformed rock vertices and triangle centers stays above 9.64m. The highest rock vertex is 60.91m, below the existing canopy maximum. The bundled scene loaded without JavaScript or WebGL errors; overview and closer screenshots were visually reviewed to confirm the beach is clear and rocks sit within the wooded interior.

## Lower tilt update — 2026-10-28

Reduced the minimum elevation angle from 33.75° to 27°, 20% closer to horizontal, while retaining the 202.5m zoom limit. All 11 gesture regression cases passed, including pure twists at the new tilt limit with both pointer delivery orders. Real multi-touch checks reached the new lower angle at maximum zoom in portrait and landscape and preserved panning, twist, up/down tilt, and Recenter without JavaScript errors. Both close-up screenshots were visually reviewed.

The near plane is now 10m to keep nearby treetops intact. At the lowest angle and closest zoom, camera height is 106.933m and the lowest near-plane corner is 98.973m, clearing the measured 96.051m canopy maximum by 2.922m throughout ground-plane panning. The overview shoreline was also visually reviewed with the updated near plane; no JavaScript or WebGL errors were reported during that check.

## Public source and demo audit — 2026-10-28

Reviewed the native host, rendering/gesture boundaries, failure handling, dependency and license records, and publication packaging. Fixed the input-driven frame-cap bypass, third-finger gesture interruption, and large-text/short-window layout defects. The code now has shared camera settings, a small tested frame scheduler, pinned formatters, JavaScript lint, a non-mutating bundle-freshness check, and a CI workflow.

- All 19 frame-loop and gesture unit tests passed.
- The portable offline production browser smoke passed: real touch gestures, 30 FPS input limit, paused/background inactivity, lighting, landscape, failure idempotency, and reload recovery. No unexpected JavaScript/WebGL errors occurred.
- Both native Compose instrumentation tests passed on an Android 36.1 emulator: nonoverlapping header at 2x font scale and a scrollable/clickable Retry in a short window. An explicit test-only Espresso 3.7.0 dependency resolves older Espresso's removed InputManager reflection API.
- Emulator smoke passed offline launch, native controls, background/foreground, local URL restrictions, blocked external requests, graphics-context loss/retry, and actual renderer-process crash/retry without killing the app process.
- Kotlin formatting, JavaScript lint/formatting, and bundle freshness checks passed. A deliberately stale bundle was rejected without modifying its files.
- npm audit reported zero known vulnerabilities, including development dependencies. This is a package advisory check, not proof that the app has no vulnerabilities.
- The Gradle wrapper JAR and distribution checksum were checked against official Gradle checksums. The CI workflow uses pinned action revisions and read-only repository permissions; it has not yet run on GitHub.
- A sanitized source copy, without local.properties or project caches, passed npm ci, JavaScript lint/formatting, bundle reproducibility, production browser smoke, Kotlin formatting, assembleDebug, and Android lint. Local documentation links and private-path/credential-pattern scans passed. The source archive excludes generated test outputs, dependencies, caches, signing keys, and APKs.

## Additional zoom and lower tilt — 2026-10-28

Reduced the minimum orbit distance from 202.5m to 172.125m and minimum elevation from 27° to 22.95°, 15% each. The existing 10m near plane is retained for shoreline precision. These limits bring some panned camera positions into tall crowns, so a local clearance helper uses precomputed crown bounds to translate camera and focus vertically together while preserving orbit distance, viewing angle, and horizontal pan. A 12m approach blend avoids an abrupt rise at a crown boundary; clear areas recover the baseline focus height.

All 24 unit tests passed, including five clearance regressions for orbit preservation, landscape aspect, smooth approach, repeated updates, reset/lowering, and the actual grove. Across 5,832 sampled centered/panned views, the correction removed all sampled eye/near-plane crown intersections; the smallest sampled near-plane clearance was 1.150m. The maximum sampled lift was 22.369m. Terrain and rocks remain below the uncorrected near plane.

The bundled browser smoke reached the new closest zoom and lowest tilt together in portrait and landscape, with both screenshots visually reviewed. Pan/twist/pinch, frame pacing, pause/background behavior, and failure recovery checks passed without unexpected JavaScript or WebGL errors. Final camera matrices are refreshed after clearance before the reflection/water passes use them.

## Selectable frame rate — 2026-10-28

Replaced the fixed 30 FPS cap with a native menu opened by tapping the FPS counter. Choices are 30 FPS, 60 FPS, and Unlocked; Unlocked is the default, and the selected mode is saved across launches. Capped modes pace both animation and input redraws. Unlocked submits on each available display callback. Android 15+ receives a view-level refresh preference while the scene is actively animating; system settings and rendering resolution are unchanged.

- All 27 unit tests passed. Frame-loop checks cover unlocked 60/90/120/144 Hz callbacks, both caps at those refresh rates, live mode changes without losing simulation time, bounded stall recovery, one pending callback, pause/background suspension, idempotent state replay, and terminal failure.
- Production browser smoke passed all three modes under touch input, mode changes while paused/backgrounded, selection retention on resume, clean failure/reload behavior, and the existing camera/clearance checks. No unexpected JavaScript or WebGL errors occurred.
- All three Compose instrumentation tests passed on the Android 36.1 emulator, including all FPS menu choices and selected-state semantics, the 2x-font header, and the reachable Retry control.
- JavaScript formatting/lint, fresh-bundle comparison, Kotlin formatting, debug APK build, and Android lint passed. Android lint reports no errors; the existing pinned-version update advisories remain.
- A short initial Pixel 8 Pro overview check in Unlocked measured approximately 41–46 submitted frames per second. This is a brief device sample, not a guaranteed speed or a sustained thermal benchmark. The display and rendering workload still bound the achievable frame rate.
- The Pixel's native menu applied all three choices to the live scene. In a subsequent short sample, 30 FPS settled near 30, the 60 FPS setting delivered about 41–46, and Unlocked delivered about 41–42. The selected 60 FPS mode survived a cold app restart; the app was then left on Unlocked. The menu and its selected radio indicator were visually reviewed on the phone.

Earlier 30 FPS measurements in this document describe the previous fixed-cap implementation.

## Storm/Sun weather — 2026-10-28

Added a Storm/Sun action immediately left of Recenter. Storm increases wind from 5 to 16 m/s, the spectrum scale from 0.65 to 1.8, swell strength from 0.45 to 1, and the shoreline amplitude setting from 0.35 to 1.2m. It also applies overcast haze, darker water, and a lower exposure target. Sun restores all calm settings and the chosen day/golden lighting. The existing FFT sizes, render targets, meshes, passes, pixel budget, and frame-rate selection are retained.

- All 30 unit tests passed, including storm strength, simulation-time/uniform preservation, full calm-setting restoration, and independent sunny lighting selection.
- All four native Compose instrumentation tests passed on Android 36.1, including Storm/Sun labels, weather accessibility state, adjacency to Recenter, and lighting independence. The full emulator smoke passed native weather controls while paused, background/foreground suspension, offline request restrictions, graphics-context recovery and renderer-process recovery; both retry paths restored the selected storm.
- The offline production browser checks passed weather changes during animation, pause and background suspension; unchanged weather replay; Sun restoration; camera preservation; and terminal failure/reload. Existing touch, close-view, FPS-selection and landscape checks also passed without unexpected JavaScript or WebGL errors.
- Portrait/landscape storm views and a lower-angle offshore Sun/Storm comparison were visually reviewed. An isolated GPU check of the longest FFT cascade measured RMS vertical displacement of about 8.42m in Storm versus 1.92m in Sun at the sampled time, with finite output and no WebGL errors. These are offshore simulation samples before shoreline attenuation, not shoreline wave heights or a physical weather forecast.
- On the Pixel 8 Pro, the native weather action appeared directly left of Recenter, switched both ways, preserved the camera/FPS selection, and restored calm settings without advancing paused simulation time. The phone's storm view was visually reviewed. A brief Unlocked storm sample measured about 41–46 submitted FPS; this is not a sustained thermal benchmark.
- JavaScript formatting/lint, fresh-bundle comparison, Kotlin formatting, Android compilation and lint passed. Android lint still reports zero errors and ten pinned-version update advisories.

## Remaining device validation

Sustained physical-device performance, heat/battery usage, and GPU compatibility across vendors remain unmeasured. Brief Pixel checks do not establish long-term performance. The app requires WebGL2 plus float rendering/filtering and multisampled half-float targets; unsupported devices show a retry/help state. No release APK, signing configuration or Play Store publication was created.
