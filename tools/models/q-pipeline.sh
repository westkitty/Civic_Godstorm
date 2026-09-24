#!/usr/bin/env bash
# Full Q conversion and evidence pipeline (master Sections 17.3, 18.3, 18.4). Run from the repo root
# with the local toolchain on PATH:
#   PATH=$PWD/.toolchain/node-v24.21.0-linux-x64/bin:$PATH tools/models/q-pipeline.sh
# Stages run in order. A failing measurement is reported (and recorded) but does not stop later
# evidence stages. The final exit status is nonzero if any gate failed.
set -u
PY=${CG_PYTHON:-.toolchain/py/bin/python}
CHROMIUM=${CG_CHROMIUM:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}
status=0
run() { echo "== $*"; "$@" || status=1; }
run "$PY" tools/models/build_volumes.py
run "$PY" tools/models/build_models.py
run "$PY" tools/models/fit_poses.py --write
run "$PY" tools/models/validate_q.py
run node tools/models/gltf-validate.ts
run "$PY" tools/models/reimport_check.py
run node tools/inspector/build-viewers.ts
run node tools/inspector/capture-evidence.ts --browser "$CHROMIUM"
run node tools/models/register-derived.ts
run npm run --silent spec:compile
exit $status
