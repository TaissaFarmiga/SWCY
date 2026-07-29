package com.hydro.geekterminal.plugin;

import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.FileInputStream;
import java.security.MessageDigest;

/**
 * SnapshotPlugin — Capacitor Android Plugin for the Web Runtime Snapshot Switch System.
 *
 * Stage 2: Verification of bridge.setServerBasePath() + reload().
 */
@CapacitorPlugin(name = "SnapshotPlugin")
public class SnapshotPlugin extends Plugin {

    private static final String TAG = "SnapshotPlugin";

    private SnapshotManager snapshotManager;

    @Override
    public void load() {
        snapshotManager = new SnapshotManager(getContext());
        Log.i(TAG, "SnapshotPlugin loaded");
    }

    /**
     * Return current snapshot status info to JavaScript.
     */
    @PluginMethod
    public void getCurrentInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("currentVersion", "");
        result.put("previousVersion", "");
        result.put("apkVersion", snapshotManager.getApkVersion());
        call.resolve(result);
    }

    /**
     * Create a test snapshot directory with a minimal index.html.
     *
     * Returns: { success: boolean, path: string }
     */
    @PluginMethod
    public void createTestSnapshot(PluginCall call) {
        try {
            String path = snapshotManager.createTestSnapshot();
            if (path != null) {
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("path", path);
                call.resolve(result);
                Log.i(TAG, "Test snapshot created at: " + path);
            } else {
                call.reject("Failed to create test snapshot directory");
            }
        } catch (Exception e) {
            Log.e(TAG, "createTestSnapshot failed", e);
            call.reject("createTestSnapshot error: " + e.getMessage());
        }
    }

    /**
     * Switch WebView to the test snapshot directory via bridge.setServerBasePath().
     *
     * Returns: { success: boolean, path: string }
     * Then reloads the WebView.
     * JS callback resolves BEFORE reload (fire-and-forget reload).
     */
    @PluginMethod
    public void applyTestSnapshot(PluginCall call) {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) {
                call.reject("Bridge is null — not yet initialized");
                return;
            }

            String path = snapshotManager.getTestDir().getAbsolutePath();
            File testDir = new File(path);
            if (!testDir.exists() || !testDir.isDirectory()) {
                call.reject("Test snapshot directory does not exist: " + path);
                return;
            }

            Log.i(TAG, "[BEFORE] setServerBasePath — current path: " + bridge.getServerBasePath());
            Log.i(TAG, "[BEFORE] setServerBasePath — target path:  " + path);

            bridge.setServerBasePath(path);

            Log.i(TAG, "[AFTER]  setServerBasePath — new path:     " + bridge.getServerBasePath());

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("path", path);
            result.put("confirmedPath", bridge.getServerBasePath());
            call.resolve(result);

            Log.i(TAG, "[BEFORE] reload — calling bridge.reload()");
            bridge.reload();
            Log.i(TAG, "[AFTER]  reload — reload request sent");
        } catch (Exception e) {
            Log.e(TAG, "applyTestSnapshot failed", e);
            call.reject("applyTestSnapshot error: " + e.getMessage());
        }
    }

    /**
     * Return the current WebView server base path (actual Capacitor path,
     * not SnapshotManager bookkeeping).
     *
     * Returns: { currentServerPath: string }
     */
    @PluginMethod
    public void readTestSnapshot(PluginCall call) {
        try {
            File indexFile = new File(snapshotManager.getTestDir(), "index.html");
            boolean exists = indexFile.exists();
            long size = exists ? indexFile.length() : -1;
            String content = exists ? snapshotManager.readTestSnapshotContent() : "";

            JSObject result = new JSObject();
            result.put("success", exists);
            result.put("exists", exists);
            result.put("size", size);
            result.put("content", content != null ? content : "");
            call.resolve(result);

            Log.i(TAG, "readTestSnapshot: exists=" + exists + " size=" + size);
            if (exists) {
                Log.i(TAG, "readTestSnapshot: content preview (first 200 chars) = " +
                    (content != null ? content.substring(0, Math.min(200, content.length())) : "null"));
            }
        } catch (Exception e) {
            Log.e(TAG, "readTestSnapshot failed", e);
            call.reject("readTestSnapshot error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("缺少 apkUrl 参数");
            return;
        }

        String expectedSha256 = call.getString("expectedSha256");
        if (expectedSha256 == null || !expectedSha256.matches("(?i)^[a-f0-9]{64}$")) {
            call.reject("缺少有效的 APK SHA-256 校验值");
            return;
        }

        final String finalUrl = apkUrl.trim();
        final String finalExpectedSha256 = expectedSha256.toLowerCase(java.util.Locale.ROOT);

        try {
            java.net.URI uri = new java.net.URI(finalUrl);
            String path = uri.getPath();
            boolean trustedRelease = path != null
                && path.matches("^/TaissaFarmiga/SWCY/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/update\\.apk$");
            if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"github.com".equalsIgnoreCase(uri.getHost())
                || uri.getUserInfo() != null
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null
                || !trustedRelease) {
                call.reject("仅允许从官方 GitHub HTTPS Release 下载 update.apk");
                return;
            }
        } catch (Exception e) {
            call.reject("APK 下载地址无效");
            return;
        }

        new Thread(() -> {
            try {
                Log.e(TAG, "开始下载 APK: " + finalUrl);

                // 1. 目标下载目录 (Android 10+ 兼容)
                File downloadDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (downloadDir == null) {
                    downloadDir = getContext().getFilesDir();
                }
                if (!downloadDir.exists()) downloadDir.mkdirs();

                File apkFile = new File(downloadDir, "update.apk");
                if (apkFile.exists()) apkFile.delete();

                // 2. GitHub Release 官方 HTTPS 下载
                okhttp3.OkHttpClient client = new okhttp3.OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(300, java.util.concurrent.TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .proxy(java.net.Proxy.NO_PROXY)
                    .build();

                okhttp3.Request request = new okhttp3.Request.Builder()
                    .url(finalUrl)
                    .addHeader("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
                    .addHeader("Accept", "*/*")
                    .addHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                    .addHeader("Cache-Control", "no-cache")
                    .build();

                okhttp3.Response response = client.newCall(request).execute();
                if (!response.isSuccessful()) {
                    call.reject("APK 下载失败: " + response.code());
                    return;
                }

                // 获取服务器期望的物理文件大小以计算真实进度
                long expectedContentLength = response.body().contentLength();

                // 3. 流式写入 APK 文件，避免大文件 OOM
                java.io.InputStream inputStream = response.body().byteStream();
                FileOutputStream fos = new FileOutputStream(apkFile);
                byte[] buffer = new byte[8192];
                int bytesRead;
                long totalBytesRead = 0;
                int lastProgress = -1;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    fos.write(buffer, 0, bytesRead);
                    totalBytesRead += bytesRead;

                    // 计算真实百分比进度并限制桥接总线发送频率 (仅在百分比变动时发射)
                    if (expectedContentLength > 0) {
                        int progress = (int) ((totalBytesRead * 100) / expectedContentLength);
                        if (progress != lastProgress) {
                            lastProgress = progress;
                            JSObject progressObj = new JSObject();
                            progressObj.put("progress", progress);
                            progressObj.put("bytesRead", totalBytesRead);
                            progressObj.put("totalBytes", expectedContentLength);
                            notifyListeners("downloadProgress", progressObj);
                        }
                    }
                }
                fos.close();
                inputStream.close();

                long actualFileLength = apkFile.length();
                Log.e(TAG, "APK 下载完成: " + apkFile.getAbsolutePath() + " (" + actualFileLength + " bytes, 期望: " + expectedContentLength + ")");

                // 【物理防截断校验】如果服务器给出了明确大小，但实际写入对不上，判定为半残坏包，物理销毁！
                if (expectedContentLength > 0 && actualFileLength != expectedContentLength) {
                    if (apkFile.exists()) {
                        apkFile.delete();
                    }
                    call.reject("安全校验失败：传输中途遭遇截断，APK 文件不完整，已物理销毁。");
                    return;
                }

                String actualSha256 = calculateSha256(apkFile);
                if (!finalExpectedSha256.equals(actualSha256)) {
                    if (apkFile.exists()) apkFile.delete();
                    call.reject("安全校验失败：APK SHA-256 不匹配，文件已删除。");
                    return;
                }
                Log.i(TAG, "APK SHA-256 校验通过: " + actualSha256);

                // 4. 通过 FileProvider 获取 content:// URI 并唤起安装
                getActivity().runOnUiThread(() -> {
                    try {
                        Uri apkUri = FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".fileprovider",
                            apkFile
                        );

                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        getContext().startActivity(intent);
                        Log.e(TAG, "系统安装界面已唤起");

                        call.resolve();
                    } catch (Exception e) {
                        Log.e(TAG, "唤起安装界面失败", e);
                        call.reject("安装失败: " + e.getMessage());
                    }
                });

            } catch (Exception e) {
                Log.e(TAG, "APK 下载流程崩溃", e);
                call.reject(e.getMessage());
            }
        }).start();
    }

    private static String calculateSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest.digest()) {
            hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        }
        return hex.toString();
    }

    @PluginMethod
    public void getCurrentServerPath(PluginCall call) {
        try {
            Bridge bridge = getBridge();
            String path;
            if (bridge != null) {
                path = bridge.getServerBasePath();
            } else {
                path = "bridge not available";
            }
            JSObject result = new JSObject();
            result.put("currentServerPath", path != null ? path : "");
            call.resolve(result);
            Log.i(TAG, "getCurrentServerPath: " + path);
        } catch (Exception e) {
            Log.e(TAG, "getCurrentServerPath failed", e);
            call.reject("getCurrentServerPath error: " + e.getMessage());
        }
    }
}
