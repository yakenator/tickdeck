// Applies tickdeck.version to every app and snippet. With --check, only reports drift (exit 1).
import { readVersion, syncVersion } from './lib.mjs';

const check = process.argv.includes('--check');
const version = readVersion();
const changed = syncVersion(version, { check });

if (check && changed.length > 0) {
  console.error(`These files do not use tickdeck ${version} (from tickdeck.version):\n  ${changed.join('\n  ')}`);
  console.error('Run `node scripts/sync-version.mjs`, then `npm install`.');
  process.exit(1);
}
console.log(changed.length === 0 ? `Everything uses tickdeck ${version}.` : `Set tickdeck ${version} in:\n  ${changed.join('\n  ')}`);
