const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const REPOSITORY = 'TaissaFarmiga/SWCY';
const API_BASE = `https://api.github.com/repos/${REPOSITORY}`;
const ROOT = path.resolve(__dirname, '..');
const APK_PATH = path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const requiresWindowsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: requiresWindowsShell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} 失败，退出码 ${result.status}${details}`);
  }
  return options.capture ? (result.stdout || '').trim() : '';
}

function git(args, options = {}) {
  return run('git', args, options);
}

function readToken() {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('缺少 GITHUB_TOKEN：请设置环境变量或本地 .env');
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => /^\s*GITHUB_TOKEN\s*=/.test(item));
  if (!line) throw new Error('本地 .env 未配置 GITHUB_TOKEN');
  const token = line.replace(/^\s*GITHUB_TOKEN\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, '');
  if (!/^(?:ghp_|github_pat_|gho_|ghu_)[A-Za-z0-9_]+$/.test(token)) throw new Error('GITHUB_TOKEN 格式无效');
  return token;
}

function authenticatedGitEnvironment(token) {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

function normalizeVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`版本号格式无效：${value}`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map(Number);
  const right = normalizeVersion(b).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function httpsRequest(url, options = {}) {
  const body = options.body === undefined
    ? null
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(String(options.body), 'utf8');

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || 'GET',
      headers: {
        ...options.headers,
        ...(body ? { 'Content-Length': String(body.length) } : {}),
      },
    }, (response) => {
      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > 4 * 1024 * 1024) {
          request.destroy(new Error('GitHub API 响应超过 4 MB 安全上限'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.setTimeout(options.timeoutMs || 60_000, () => {
      request.destroy(new Error('GitHub API 请求超时'));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function githubRequest(token, endpoint, options = {}) {
  const method = options.method || 'GET';
  const response = await httpsRequest(`${API_BASE}${endpoint}`, {
    method,
    body: options.body,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'HydroTerminal-Release',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
  let data = null;
  if (response.text) {
    try {
      data = JSON.parse(response.text);
    } catch {
      throw new Error(`GitHub API ${method} ${endpoint} 返回无效 JSON（HTTP ${response.statusCode}）`);
    }
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GitHub API ${method} ${endpoint} 失败（HTTP ${response.statusCode}）：${data?.message || response.text}`);
  }
  return data;
}

function assertCleanWorktree(stage) {
  const status = git(['status', '--porcelain'], { capture: true });
  if (status) throw new Error(`${stage}检测到未提交修改；发布已停止，禁止自动 git add`);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  const token = readToken();
  const gitEnv = authenticatedGitEnvironment(token);
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = normalizeVersion(packageJson.version);
  const tag = `v${version}`;
  const branch = git(['branch', '--show-current'], { capture: true });
  const origin = git(['remote', 'get-url', 'origin'], { capture: true });

  if (!['main', 'master'].includes(branch)) throw new Error(`只允许从 main/master 发布，当前分支：${branch}`);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)TaissaFarmiga\/SWCY(?:\.git)?$/i.test(origin)) {
    throw new Error(`origin 必须指向 GitHub ${REPOSITORY}，当前：${origin}`);
  }
  assertCleanWorktree('发布前');

  const latest = await githubRequest(token, '/releases/latest');
  if (compareVersions(version, latest.tag_name) <= 0) {
    throw new Error(`待发布版本 ${version} 必须高于 GitHub 最新版本 ${latest.tag_name}`);
  }
  const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { capture: true, env: gitEnv });
  if (remoteTag) throw new Error(`远端标签 ${tag} 已存在，禁止覆盖`);

  console.log(`[release] 验证 ${tag}`);
  run(commandName('npm'), ['run', 'typecheck']);
  run(commandName('npm'), ['run', 'lint']);
  run(commandName('npm'), ['test']);
  run(commandName('npm'), ['run', 'build']);
  run(commandName('npx'), ['cap', 'sync', 'android']);
  run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--no-daemon', '--console=plain', '-q'], { cwd: path.join(ROOT, 'android') });

  if (!fs.existsSync(APK_PATH) || fs.statSync(APK_PATH).size <= 0) throw new Error('Android APK 未生成');
  assertCleanWorktree('构建后');

  const commit = git(['rev-parse', 'HEAD'], { capture: true });
  const digest = sha256(APK_PATH);
  const size = fs.statSync(APK_PATH).size;

  console.log(`[release] 推送源码 ${commit.slice(0, 12)} 到 GitHub main`);
  git(['push', 'origin', 'HEAD:main'], { env: gitEnv });
  git(['tag', '-a', tag, '-m', `水文测验终端 ${tag}`]);
  try {
    git(['push', 'origin', tag], { env: gitEnv });
  } catch (error) {
    git(['tag', '-d', tag]);
    throw error;
  }

  if (process.platform === 'win32') {
    try {
      const releaseName = `水文测验终端 ${tag}`;
      const releaseNotes = `## 更新内容\n\n- 水准测量完整闭环与成果导出\n- 流量偏离率、电子气泡工具\n- 首页版本更新中心与移动端交互优化\n- GitHub 单一可信更新通道\n\nAPK SHA-256: ${digest}`;
      const output = run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(ROOT, 'scripts/publish-github-release.ps1'),
        '-Repository',
        REPOSITORY,
        '-Tag',
        tag,
        '-Commit',
        commit,
        '-ApkPath',
        APK_PATH,
        '-ApkSize',
        String(size),
        '-Digest',
        digest,
        '-ReleaseNameBase64',
        Buffer.from(releaseName, 'utf8').toString('base64'),
        '-ReleaseNotesBase64',
        Buffer.from(releaseNotes, 'utf8').toString('base64'),
      ], {
        capture: true,
        env: { ...process.env, GITHUB_TOKEN: token },
      });
      const published = JSON.parse(output);
      console.log(JSON.stringify(published, null, 2));
      return;
    } catch (error) {
      try { git(['push', 'origin', `:refs/tags/${tag}`], { env: gitEnv }); } catch { /* best effort */ }
      try { git(['tag', '-d', tag]); } catch { /* best effort */ }
      throw error;
    }
  }

  let release = null;
  try {
    release = await githubRequest(token, '/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: commit,
        name: `水文测验终端 ${tag}`,
        body: `## 更新内容\n\n- 水准测量完整闭环与成果导出\n- 流量偏离率、电子气泡工具\n- 首页版本更新中心与移动端交互优化\n- GitHub 单一可信更新通道\n\nAPK SHA-256: \`${digest}\``,
        draft: true,
        prerelease: false,
        generate_release_notes: true,
      }),
    });

    const uploadResponse = await httpsRequest(`${release.upload_url.split('{')[0]}?name=update.apk`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.android.package-archive',
        'User-Agent': 'HydroTerminal-Release',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: fs.readFileSync(APK_PATH),
      timeoutMs: 300_000,
    });
    if (uploadResponse.statusCode < 200 || uploadResponse.statusCode >= 300) {
      throw new Error(`APK 上传失败（HTTP ${uploadResponse.statusCode}）：${uploadResponse.text}`);
    }

    const draft = await githubRequest(token, `/releases/${release.id}`);
    const draftAsset = draft.assets.find((item) => item.name === 'update.apk' && item.state === 'uploaded');
    if (!draftAsset || draftAsset.size !== size || draftAsset.digest !== `sha256:${digest}`) {
      throw new Error('GitHub Draft Release 回读校验失败：APK 大小或 SHA-256 不一致');
    }

    await githubRequest(token, `/releases/${release.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: false }),
    });
  } catch (error) {
    if (release?.id) {
      try { await githubRequest(token, `/releases/${release.id}`, { method: 'DELETE' }); } catch { /* best effort */ }
    }
    try { git(['push', 'origin', `:refs/tags/${tag}`], { env: gitEnv }); } catch { /* best effort */ }
    try { git(['tag', '-d', tag]); } catch { /* best effort */ }
    throw error;
  }

  const published = await githubRequest(token, `/releases/tags/${tag}`);
  const asset = published.assets.find((item) => item.name === 'update.apk' && item.state === 'uploaded');
  if (!asset || asset.size !== size || asset.digest !== `sha256:${digest}`) throw new Error('已发布 Release 回读失败');

  console.log(JSON.stringify({
    version,
    tag,
    commit,
    releaseUrl: published.html_url,
    apkSize: size,
    sha256: digest,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
