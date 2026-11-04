#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Run the Python inference-service tests on any checkout (issue #34).
 *
 * Picks an interpreter in this order:
 *   1. $PYTHON (explicit override)
 *   2. apps/inference-service/.venv/bin/python   (if it can import fastapi+pytest)
 *   3. python3 / python                          (if it can import fastapi+pytest)
 *   4. create apps/inference-service/.venv and `pip install -r requirements.txt`
 *
 * Then execs `python -m pytest tests`. Exits non-zero on any failure, so it is
 * CI-safe and never depends on a stale, path-pinned virtualenv.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICE = path.join(ROOT, 'apps', 'inference-service');
const VENV = path.join(SERVICE, '.venv');
const isWin = process.platform === 'win32';
const venvPython = path.join(VENV, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function canRun(py) {
  if (!py) return false;
  const r = spawnSync(py, ['-c', 'import fastapi, pytest'], { stdio: 'ignore' });
  return r.status === 0;
}

function which(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return r.status === 0 ? cmd : null;
}

function pick() {
  const candidates = [process.env.PYTHON, venvPython, which('python3'), which('python')].filter(Boolean);
  for (const py of candidates) {
    if (canRun(py)) return py;
  }
  return null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: SERVICE, ...opts });
  if (r.error) throw r.error;
  return r.status === 0;
}

let python = pick();
if (!python) {
  const base = which('python3') || which('python');
  if (!base) {
    console.error('[test:inference] no python3 interpreter found');
    process.exit(2);
  }
  console.log('[test:inference] creating apps/inference-service/.venv and installing requirements...');
  if (!fs.existsSync(venvPython)) {
    if (!run(base, ['-m', 'venv', VENV])) {
      console.error('[test:inference] failed to create the virtualenv');
      process.exit(2);
    }
  }
  const pip = path.join(VENV, isWin ? 'Scripts' : 'bin', isWin ? 'pip.exe' : 'pip');
  if (!run(pip, ['install', '--quiet', '-r', 'requirements.txt'])) {
    console.error('[test:inference] failed to install requirements.txt');
    process.exit(2);
  }
  python = venvPython;
}

const args = process.argv.slice(2);
const pytestArgs = args.length ? args : ['tests'];
const ok = run(python, ['-m', 'pytest', '-q', ...pytestArgs]);
process.exit(ok ? 0 : 1);
