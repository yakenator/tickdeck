import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = process.argv.length > 2 ? process.argv.slice(2) : ['LICENSE', 'NOTICE'];

for (const file of files) {
  copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), file);
}
