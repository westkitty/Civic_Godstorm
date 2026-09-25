# Toolchain record (M00)

These versions were resolved on 2026-09-23 against the npm registry and nodejs.org, and are pinned exactly in `package.json` and `package-lock.json` (lockfileVersion 3, 213 packages). `.npmrc` sets `engine-strict` and `save-exact`.

## Runtime and package manager

| Tool | Version | Basis |
|---|---|---|
| Node.js | 24.21.0 (LTS "Krypton") | Current maintained LTS on nodejs.org/dist/index.json. v26.x is a Current release and v20 is past end of life |
| npm | 11.19.0 (bundled with Node 24.21.0) | |

The machine's global Node was 26.9.0 (Homebrew) and was not modified. To run the project without changing global tools:

```bash
mkdir -p .toolchain && cd .toolchain && curl -sSfO https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz
```

Verify the archive against `https://nodejs.org/dist/v24.21.0/SHASUMS256.txt`, extract it, and prefix `PATH` with `.toolchain/node-v24.21.0-darwin-arm64/bin`. A version manager honouring `.nvmrc` works equally well.

## Direct dependencies

| Package | Version | License | Role |
|---|---|---|---|
| react | 19.3.0 | MIT | runtime: semantic DOM UI |
| react-dom | 19.3.0 | MIT | runtime |
| three | 0.186.0 | MIT | runtime: `WebGLRenderer` world |
| typescript | 6.0.3 | Apache-2.0 | strict typecheck (7.0.2 rejected: typescript-eslint peer range `<6.1.0`) |
| vite | 8.3.0 | MIT | dev server and build |
| @vitejs/plugin-react | 6.1.1 | MIT | build |
| vitest | 5.0.1 | MIT | unit/sim/tool tests |
| @playwright/test | 1.63.0 | Apache-2.0 | browser journeys |
| eslint | 10.11.0 | MIT | lint and architecture rules |
| @eslint/js | 10.0.1 | MIT | lint |
| typescript-eslint | 8.70.1 | MIT | type-aware lint |
| eslint-plugin-react-hooks | 7.1.1 | MIT | lint |
| globals | 17.12.0 | MIT | lint |
| @types/node | 24.13.6 | MIT | types matching Node 24 |
| @types/react, @types/react-dom | 19.3.0 | MIT | types |
| @types/three | 0.186.0 | MIT | types |

## License inventory (from the lockfile)

The shipped runtime is `react`, `react-dom`, `scheduler` and `three`, all MIT. The full tree breaks down as follows:

| License | Packages |
|---|---|
| MIT | 160 |
| Apache-2.0 | 20 |
| MPL-2.0 | 12 |
| ISC | 11 |
| BSD-2-Clause | 6 |
| BSD-3-Clause | 2 |
| CC-BY-4.0 | 1 |
| BlueOak-1.0.0 | 1 |

The MPL-2.0 entries are `lightningcss` and its platform binaries, CC-BY-4.0 is `caniuse-lite`, and BlueOak is `minimatch`. All three are build-time dev dependencies that are not bundled into the game. The full inventory is in `artifacts/evidence/M00/license-inventory.json`. The release provenance and license audit is an M14 obligation.

## Host facts recorded at M00

Apple M1 with 8 GiB, macOS 26.6.2, Google Chrome 153.0.8010.53, Blender 5.2.2 LTS, Python 3.14.7 and git 2.55.0. Firefox is not installed. See `artifacts/evidence/M00/environment.json` (`npm run probe:env -- --out <dir>`). Blender is recorded for the M03 conversion feasibility probe. It has not been exercised.
