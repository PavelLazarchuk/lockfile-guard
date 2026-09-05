import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm', 'cjs'],
    target: 'node20',
    platform: 'node',
    dts: { entry: 'src/index.ts' },
    clean: true,
    treeshake: true,
    define: { __CLI_VERSION__: JSON.stringify(version) },
    external: ['yaml'],
});
