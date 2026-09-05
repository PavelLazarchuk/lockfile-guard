import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
    define: { __CLI_VERSION__: JSON.stringify(version) },
    test: {
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts', 'src/cli.ts', '**/*.d.ts'],
            reporter: ['text', 'html'],
            thresholds: {
                lines: 90,
                statements: 90,
                functions: 90,
                branches: 90,
            },
        },
    },
});
