import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ffPath = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const profileDir = path.join(os.tmpdir(), `ff_prof_${Date.now()}`);
fs.mkdirSync(profileDir, { recursive: true });

const outFile = path.resolve('./firefox_shot.png');
if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

console.log('Running Firefox with profile:', profileDir);
const res = spawnSync(ffPath, [
  '-no-remote',
  '-profile', profileDir,
  '--headless',
  `--screenshot=${outFile}`,
  '--window-size=1280,1024',
  'http://localhost:3000'
], { encoding: 'utf8', timeout: 15000 });

console.log('Firefox status:', res.status);
console.log('Firefox stdout:', res.stdout);
console.log('Firefox stderr:', res.stderr);

if (fs.existsSync(outFile)) {
  const stat = fs.statSync(outFile);
  console.log('Screenshot created successfully! Size:', stat.size);
} else {
  console.error('Screenshot NOT created');
}

try {
  fs.rmSync(profileDir, { recursive: true, force: true });
} catch (e) {}
