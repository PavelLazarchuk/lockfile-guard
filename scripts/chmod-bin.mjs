/**
 * tsup emits the CLI as a plain module. A bin entry needs the shebang and the executable bit, and
 * `npm pack` preserves the mode it finds on disk — so both are applied here, after every build.
 */
import { chmod, readFile, writeFile } from 'node:fs/promises';

const SHEBANG = '#!/usr/bin/env node\n';
const BINARIES = ['dist/cli.js', 'dist/cli.cjs'];

for (const file of BINARIES) {
    const code = await readFile(file, 'utf8');

    if (!code.startsWith('#!')) await writeFile(file, SHEBANG + code);
    await chmod(file, 0o755);
}

console.log(`chmod-bin: prepared ${BINARIES.length} bin entrypoint(s).`);
