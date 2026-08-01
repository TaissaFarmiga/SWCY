const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const rounds = 10;
const evidenceRoot = join(projectRoot, 'verification', `mobile-ux-v${packageJson.version}`);
const summaryPath = join(evidenceRoot, 'full-verification-10-rounds.json');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this script through npm.');
const npmCommand = process.execPath;
const gates = [
  { label: 'typecheck', command: npmCommand, args: [npmCli, 'run', 'typecheck'] },
  { label: 'lint', command: npmCommand, args: [npmCli, 'run', 'lint'] },
  { label: 'business-tests', command: npmCommand, args: [npmCli, 'test'] },
  { label: 'production-build', command: npmCommand, args: [npmCli, 'run', 'build'] },
];

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function sourceFingerprint() {
  const diff = gitOutput(['diff', '--binary', '--no-ext-diff']);
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all']);
  return createHash('sha256').update(diff).update('\0').update(status).digest('hex');
}

function persist(summary) {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

const summary = {
  schemaVersion: 1,
  appVersion: packageJson.version,
  requestedRounds: rounds,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: 'running',
  gitHead: gitOutput(['rev-parse', 'HEAD']),
  sourceFingerprint: sourceFingerprint(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  rounds: [],
};

persist(summary);

for (let round = 1; round <= rounds; round += 1) {
  const roundResult = { round, startedAt: new Date().toISOString(), completedAt: null, status: 'running', gates: [] };
  summary.rounds.push(roundResult);
  persist(summary);
  console.log(`\n[full-verification] round ${round}/${rounds}`);

  for (const gate of gates) {
    const started = Date.now();
    console.log(`[full-verification] ${gate.label}`);
    const result = spawnSync(gate.command, gate.args, { cwd: projectRoot, stdio: 'inherit', shell: false });
    const status = typeof result.status === 'number' ? result.status : 1;
    roundResult.gates.push({
      label: gate.label,
      command: [gate.command, ...gate.args].join(' '),
      exitCode: status,
      durationMs: Date.now() - started,
      error: result.error ? result.error.message : null,
    });
    persist(summary);
    if (status !== 0) {
      roundResult.status = 'failed';
      roundResult.completedAt = new Date().toISOString();
      summary.status = 'failed';
      summary.completedAt = roundResult.completedAt;
      persist(summary);
      process.exit(status);
    }
  }

  roundResult.status = 'passed';
  roundResult.completedAt = new Date().toISOString();
  persist(summary);
}

summary.status = 'passed';
summary.completedAt = new Date().toISOString();
summary.completedRounds = summary.rounds.filter((round) => round.status === 'passed').length;
summary.totalGates = summary.rounds.reduce((total, round) => total + round.gates.length, 0);
summary.finalSourceFingerprint = sourceFingerprint();
persist(summary);
console.log(`[full-verification] PASS ${summary.completedRounds}/${rounds} rounds, ${summary.totalGates} gates`);
console.log(`[full-verification] evidence ${summaryPath}`);
