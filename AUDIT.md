# Public source and demo audit — 2026-10-28

## Outcome and scope

No remaining blocking issue was found for publishing this source and a clearly labeled development/demo APK within the reviewed scope. This is not a store-release certification or a guarantee against defects, security issues, or subjective criticism.

The Compose UI, restricted offline WebView host, scene composition, frame loop, and touch adapter have clear responsibilities. The architecture is proportionate to a one-screen visual demo. A ViewModel, dependency-injection framework, or data/repository layer would add indirection without solving a present requirement.

## Findings resolved

| Finding | Resolution and evidence |
| --- | --- |
| Input bypassed the advertised 30 FPS cap, reaching 60/120 FPS in scheduler reproduction | A dedicated frame loop applies the selected cap to animation and input. The later FPS selector intentionally allows unlocked rendering; 30/60 modes retain shared pacing. |
| Adding and removing a third finger could leave two-finger rotation inactive | Rebase the remaining pointers; pointer-up and cancellation regression cases pass. |
| Repeated native state replay reset FPS timing; failure handling could repeat | State transitions are idempotent; failure stops scheduling and reports/reset FPS once. |
| Large text allowed the title to overlap FPS | A shared constrained header layout; measured 2x-font instrumentation test passes. |
| Retry could be unreachable in short windows | Scrollable status content; constrained-height instrumentation test reaches and clicks Retry. |
| Android builds could silently use stale prebuilt JavaScript | A non-mutating fresh-build comparison rejects differences; both matching and deliberately stale cases were checked. |
| Style had no repeatable gate | Pinned ESLint, Prettier, Spotless/ktlint, shared editor settings, and CI checks. Vendor formatting remains untouched. |
| Original code had no reuse license | Added the Unlicense as requested; third-party licenses remain intact and are bundled. |
| A raw folder archive would include machine settings/caches | Prepared and clean-built an explicit source-only export; local links and sensitive-pattern checks pass. |

## Verification

- 19 frame-loop/gesture unit tests passed.
- 2 native Compose layout instrumentation tests passed on Android 36.1.
- Offline production browser checks passed, including real touch gestures and capped rendering during input.
- Android smoke passed native controls, lifecycle suspension/resume, local and external URL blocking, graphics-context loss/retry, and renderer-process crash/retry.
- A separate clean source copy passed dependency installation, style checks, bundle reproduction, browser checks, Android build, and lint.
- npm audit reported zero known vulnerabilities at audit time. Android lint has no errors; dependency-version update advisories remain. This does not constitute a full dependency vulnerability certification.
- Gradle wrapper provenance/checksums and vendored Ultra-Water license/revision were verified. GitHub workflow actions are revision-pinned with read-only repository permissions.

See [VERIFICATION.md](VERIFICATION.md) for the recorded scope and [CONTRIBUTING.md](CONTRIBUTING.md) for repeatable commands.

## Limits to state publicly

The later 15% zoom/tilt expansion has separate verification in [VERIFICATION.md](VERIFICATION.md): 24 unit tests, local canopy-clearance geometry checks, and the updated production browser checks pass. Native UI code is unchanged by that expansion.

The subsequent FPS selector replaces the fixed cap with saved 30/60/Unlocked choices. Its verification is also recorded there: 27 unit tests, three native UI tests, updated browser checks, and brief Pixel measurements. Unlocked removes the app's scheduling cap; it does not guarantee a particular hardware frame rate.

Storm/Sun weather is a later scoped addition using the existing simulation and rendering resources. Its 30 unit tests, four native UI tests, full Android smoke, browser, visual and Pixel verification are recorded in [VERIFICATION.md](VERIFICATION.md); the original audit's counts above remain a record of that earlier audit.

The later close-water request intentionally removes tree/terrain camera avoidance and permits a 5m orbit at 1° elevation. Its updated 26-test suite, browser gesture checks, projection measurements and visual limits are recorded in [VERIFICATION.md](VERIFICATION.md). A full underwater rendering pass is outside this demo's current scope.

- This is a debug demo with a development signature and debugging enabled, not a hardened store release. Do not imply otherwise in download descriptions.
- Hosted GitHub verification has started; a complete passing run remains pending after adding explicit SDK setup. See the publication notes in [VERIFICATION.md](VERIFICATION.md).
- Sustained phone thermals/battery consumption and a broad GPU/WebView device matrix remain unmeasured.
- The 3D interaction remains primarily visual and gesture-driven; native controls support accessibility, but the scene is not a complete nonvisual experience.
- The Unlicense applies to original code only. Redistributed third-party code keeps its own notices and terms.

## References checked

- [Android local-content architecture](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
- [Gradle wrapper verification](https://docs.gradle.org/current/userguide/gradle_wrapper.html)
- [Pinned Ultra-Water license](https://github.com/Humpalumps/Ultra-Water/blob/e58ddcdc18ea779b9386a2e5c76f2c6329c8bab9/LICENSE)
- [Unlicense terms](https://unlicense.org/)
- [AndroidX Test 3.7.0 compatibility fix](https://developer.android.com/jetpack/androidx/releases/test#espresso-3.7.0)
