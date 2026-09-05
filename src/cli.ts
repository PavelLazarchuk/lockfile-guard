import { run } from './cli/run';

void run(process.argv.slice(2), {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
    cwd: process.cwd(),
    env: process.env,
}).then(
    code => {
        process.exitCode = code;
    },
    (error: unknown) => {
        process.stderr.write(
            `lockfile-guard: ${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 2;
    }
);
