export const GITHUB_REPOSITORY = 'TaissaFarmiga/SWCY';
export const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
export const UPDATE_CHECK_TIMEOUT_MS = 12_000;

export interface GitHubUpdateAsset {
  name: 'update.apk';
  size: number;
  url: string;
  sha256: string;
}

export interface GitHubUpdateRelease {
  version: string;
  tag: string;
  title: string;
  notes: string;
  publishedAt: string | null;
  htmlUrl: string;
  asset: GitHubUpdateAsset;
}

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  release: GitHubUpdateRelease;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeVersion(value: string): string {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) throw new Error(`版本号格式无效：${value}`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split('.').map(Number);
  const right = normalizeVersion(b).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function validateReleaseUrl(rawUrl: string, expectedPath: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('GitHub Release 下载地址无效');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== expectedPath) {
    throw new Error('更新包不是受信任的 GitHub Release 资源');
  }
  return url.toString();
}

export function parseGitHubRelease(value: unknown): GitHubUpdateRelease {
  if (!isRecord(value) || typeof value.tag_name !== 'string' || !Array.isArray(value.assets)) {
    throw new Error('GitHub Release 数据格式无效');
  }

  const version = normalizeVersion(value.tag_name);
  const tag = `v${version}`;
  const expectedAssetPath = `/${GITHUB_REPOSITORY}/releases/download/${tag}/update.apk`;
  const rawAsset = value.assets.find((asset) => isRecord(asset) && asset.name === 'update.apk');
  if (
    !isRecord(rawAsset)
    || rawAsset.state !== 'uploaded'
    || typeof rawAsset.size !== 'number'
    || !Number.isFinite(rawAsset.size)
    || rawAsset.size <= 0
    || typeof rawAsset.browser_download_url !== 'string'
    || typeof rawAsset.digest !== 'string'
  ) {
    throw new Error('GitHub Release 缺少完整的 update.apk');
  }

  const digestMatch = rawAsset.digest.match(/^sha256:([a-f0-9]{64})$/i);
  if (!digestMatch) throw new Error('GitHub Release 缺少有效的 SHA-256');

  const htmlUrl = typeof value.html_url === 'string'
    ? validateReleaseUrl(value.html_url, `/${GITHUB_REPOSITORY}/releases/tag/${tag}`)
    : `https://github.com/${GITHUB_REPOSITORY}/releases/tag/${tag}`;

  return {
    version,
    tag,
    title: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `版本 ${version}`,
    notes: typeof value.body === 'string' && value.body.trim() ? value.body.trim() : '稳定性改进与问题修复。',
    publishedAt: typeof value.published_at === 'string' && Number.isFinite(Date.parse(value.published_at))
      ? value.published_at
      : null,
    htmlUrl,
    asset: {
      name: 'update.apk',
      size: rawAsset.size,
      url: validateReleaseUrl(rawAsset.browser_download_url, expectedAssetPath),
      sha256: digestMatch[1].toLowerCase(),
    },
  };
}

export async function checkGitHubUpdate(currentVersion: string, signal?: AbortSignal): Promise<UpdateCheckResult> {
  const normalizedCurrent = normalizeVersion(currentVersion);
  if (signal?.aborted) throw new Error('更新检查已取消');

  const requestController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => requestController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, UPDATE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: requestController.signal,
    });
    if (!response.ok) throw new Error(`GitHub 更新查询失败（HTTP ${response.status}）`);
    const release = parseGitHubRelease(await response.json());
    return {
      available: compareVersions(release.version, normalizedCurrent) > 0,
      currentVersion: normalizedCurrent,
      release,
    };
  } catch (error: unknown) {
    if (timedOut) throw new Error('GitHub 更新查询超时，请稍后重试');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function formatAssetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
