import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = await readFile(new URL('./preset.mjs', import.meta.url), 'utf8');
const template = await readFile(new URL('./preview.template.html', import.meta.url), 'utf8');
const notice = await readFile(new URL('./THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
const marker = '/*__PRESET_MODULE__*/';
if (template.split(marker).length !== 2) throw Error('INVALID_BUILD_MARKER');
const destination = process.argv[2] ?? fileURLToPath(new URL('./preview.html', import.meta.url));
const html = template.replace(marker, () => source).replace('<head>', () => `<head>\n<!--\n${notice}\n-->\n`);
// Exclusive creation: never overwrite a previous preview or user file.
await writeFile(destination, html, {flag:'wx'});
console.log(destination);
