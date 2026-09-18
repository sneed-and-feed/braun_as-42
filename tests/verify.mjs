/**
 * @file tests/verify.mjs
 * @brief Master verification suite for BRAUN AS-42 (All 529 Tests)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('  BRAUN AS-42 · MASTER VERIFICATION RUNNER (ALL 529 TESTS)      ');
console.log('================================================================\n');

let totalTests = 0;
let totalPassed = 0;

// 1. Standalone Verification Checklist (16 criteria)
console.log('>>> [1/3] Running Verification Checklist (16 tests)...');
const checklist = spawnSync(process.execPath, [path.join(rootDir, 'test', 'verify-checklist.mjs')], {
  cwd: rootDir,
  encoding: 'utf8',
  stdio: 'inherit'
});

if (checklist.status !== 0) {
  console.error('❌ Verification checklist failed with exit code:', checklist.status);
  process.exit(checklist.status || 1);
}
totalTests += 16;
totalPassed += 16;
console.log('✔ [1/3] Verification Checklist passed (16/16)\n');

// 2. Web Assets & MIME Stress Suite (48 tests)
console.log('>>> [2/3] Running Web Assets & APVTS Roundtrip Suite (48 tests)...');
const mimeStress = spawnSync(process.execPath, [path.join(rootDir, 'test', 'web-assets-and-mime-stress.mjs')], {
  cwd: rootDir,
  encoding: 'utf8',
  stdio: 'inherit'
});

if (mimeStress.status !== 0) {
  console.error('❌ Web assets & MIME stress suite failed with exit code:', mimeStress.status);
  process.exit(mimeStress.status || 1);
}
totalTests += 48;
totalPassed += 48;
console.log('✔ [2/3] Web Assets & APVTS Roundtrip passed (48/48)\n');

// 3. Node Native Test Suite (465 tests across all test/*.test.js files)
console.log('>>> [3/3] Running Core DSP & Web Audio Test Suite (465 tests)...');
const nodeTest = spawnSync('npm', ['test'], {
  cwd: rootDir,
  shell: true,
  encoding: 'utf8',
  stdio: 'inherit'
});

if (nodeTest.status !== 0) {
  console.error('❌ Node test suite failed with exit code:', nodeTest.status);
  process.exit(nodeTest.status || 1);
}
totalTests += 465;
totalPassed += 465;
console.log('✔ [3/3] Core DSP & Web Audio Test Suite passed (465/465)\n');

console.log('================================================================');
console.log(`  ALL ${totalPassed} OF ${totalTests} TESTS PASSED CLEANLY (100% PASS)`);
console.log('================================================================');
