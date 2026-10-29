# Verification and remaining work

- [x] Bundle the pinned Ultra-Water renderer and Three.js for offline use.
- [x] Implement centered island, instanced palms and vegetation, bounded touch camera.
- [x] Move boulders into the wooded interior and visually verify a clear sandy beach in the bundled scene.
- [x] Expand close zoom to 202.5m (another 10% closer than 225m); verify one-finger ground-plane panning, two-finger rotation, pinch zoom, and Recenter in both orientations.
- [x] Add Maps-style two-finger twisting while preserving up/down tilt and close pinch zoom; verify real multi-touch input in the bundled scene.
- [x] Lower the minimum viewing angle from 33.75° to 27° (20%); verify maximum zoom, tilt, pan, twist, and Recenter in portrait and landscape.
- [x] Extend close zoom to 172.125m and lowest elevation to 22.95° (15% each), with local treetop clearance and combined-limit checks in both orientations.
- [x] Supersede those limits with a 5m orbit, 1° elevation, and a focus at sea level; remove the tree-clearance lift and adapt the near plane for close wave views.
- [x] Implement Compose host, native controls, lifecycle cleanup and retry state.
- [x] Add Storm/Sun beside Recenter, with stronger waves, overcast lighting, restoration of sunny settings, and weather state retained through recreation/retry.
- [x] Verify debug APK build and Android lint (zero errors; pinned-version update advisories remain).
- [x] Align AGP with Android Studio Quail 3 and verify successful IDE sync, app build, and native test APK compilation.
- [x] Place the landscape gesture hint beside the controls, aligned with the right edge of FPS; verify on the Pixel.
- [x] Verify offline bundled renderer in portrait/landscape, pause, lighting and recenter.
- [x] Verify app launch, live/paused FPS display, touch controls, background/foreground, and rotation state restoration in an Android 36.1 emulator.
- [ ] Measure sustained performance and battery use on a physical Android device.
- [x] Audit public source/demo architecture and add pinned format, lint, and bundle-freshness checks.
- [x] Apply selected frame limits to input as well as animation, and restore two-finger gestures after a third finger lifts/cancels.
- [x] Replace the fixed 30 FPS limit with a tappable 30/60/Unlocked selector, defaulting to Unlocked and saving the choice across launches.
- [x] Add frame-loop lifecycle tests and portable offline browser smoke checks.
- [x] Fix and test large-text header layout and reachable Retry in short windows.
- [x] Add the Unlicense for original code and retain bundled third-party notices.
- [x] Complete a successful hosted GitHub Actions run: [40791636495](https://github.com/abiemann/AndroidIslandLife/actions/runs/40791636495) passed source checks, Android compilation/lint, production browser checks, and all four native Compose tests.
- [ ] Broaden physical GPU/WebView coverage and evaluate nonvisual camera-control alternatives.

No store release, release signing, audio, accounts or networking are included.

Verification date: 2026-10-28. See `VERIFICATION.md` for scope and limits.
