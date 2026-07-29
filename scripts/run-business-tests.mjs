import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporaryDirectory = await mkdtemp(path.resolve('_AI_Tools_', '.business-tests-'));
const outputFile = path.join(temporaryDirectory, 'business-tests.mjs');

try {
  await build({
    entryPoints: [path.resolve('scripts/business-tests.ts')],
    outfile: outputFile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: 'inline',
    logLevel: 'warning',
  });
  await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
