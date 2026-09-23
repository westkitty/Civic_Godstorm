# M02 - Independent re-verification on a second host

**Purpose.** A new session resumed from the repository after the M02 session ended. The build prompt says another agent's report is a claim until independently checked. This record re-runs the M00-M02 gates on a different host. It adds no features and does not change the M02 verdict.

**Code under test.** Commit `c115d7b` (M02), fast-forwarded unchanged onto `claude/kind-cori-3sxtdg`. Logs are in `artifacts/evidence/M02/reverify-linux-x64/`.

## Host

- Linux x86_64 cloud container with 4 CPUs.
- Node 24.21.0 and npm 11.19.0, the pinned toolchain. The official `linux-x64` archive was checked against `SHASUMS256.txt` and unpacked into the gitignored `.toolchain/`. The container's global Node 22 was not changed.
- `npm ci` ran from the committed lockfile with `engine-strict`.
- Browser: preinstalled Playwright Chromium 141.0.7390.37. Google Chrome, Firefox and WebKit are not available here.

## Results

| Command | Exit | Result | Same as M02 record? |
|---|---|---|---|
| typecheck, lint | 0 | pass | yes |
| test:unit | 0 | 32/32 | yes |
| test:sim | 0 | 59/59 | yes |
| test:assets | 0 | 285 IDs unresolved (development gate) | yes |
| build | 0 | pass | yes |
| validate:release | 1 | correct: assets unresolved | yes |
| test:campaigns | 0 | 50/50 reruns identical | yes |
| e2e journeys | 0 | 16/16 on Chromium, desktop 1440×900 and narrow 800×1100 | the Chromium subset of the M02 matrix |

## Cross-platform determinism

All 50 final campaign hashes from this x86_64 Linux run match `artifacts/evidence/M02/campaigns/campaigns.json`, which was recorded on the Apple M1 macOS host. The browser self-check also matched the committed Node fixture in Chromium. That gives two runtimes on two architectures. It is not the full M13 cross-runtime matrix.

## Deviations (not claimed)

- **Browser configuration.** The committed `playwright.config.ts` asks for the Google Chrome channel, Firefox and WebKit. Here the same `tests/e2e` specs ran through a local-only config that points at the preinstalled Chromium. A copy of that config is kept as `playwright.linux-chromium.config.ts.txt`. This run does not re-verify Chrome 153, Firefox or WebKit.
- **Touch.** Touch was emulated in Chromium only. It is not physical-device evidence.
