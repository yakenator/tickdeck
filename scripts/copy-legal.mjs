import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const file of ['LICENSE', 'NOTICE']) {
  copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), file);
}
