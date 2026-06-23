package com.hydro.geekterminal.plugin;

import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hydro.geekterminal.MainActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

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

    /**
     * Receive extracted snapshot path from frontend, set it to MainActivity
     * interceptor, then trigger WebView reload.
     */
    @PluginMethod
    public void applySnapshot(PluginCall call) {
        String path = call.getString("path"); // 目标沙盒路径 /snapshots/v2.0.0

        // 1. 获取前端传来的原始被污染的 URL
        String rawUrl = call.getString("zipUrl");
        if (rawUrl == null || rawUrl.isEmpty()) {
            call.reject("缺少 zipUrl 参数，无法下载");
            return;
        }

        // 2. 终极暴力清洗：无论前端在前面拼接了什么垃圾字符，
        // 我们只截取最后一次出现 "https://" 及其后面的所有内容。
        int httpsIndex = rawUrl.lastIndexOf("https://");
        if (httpsIndex != -1) {
            rawUrl = rawUrl.substring(httpsIndex);
        }

        // 去除可能存在的首尾空格与不可见字符
        rawUrl = rawUrl.trim();

        // 3. 声明不可变的 final 变量，专门喂给异步线程
        final String targetUrl = rawUrl;

        Log.e(TAG, "接收到清洗后的动态下载地址: " + targetUrl);

        // 启动异步线程下载，防止阻塞 UI
        new Thread(() -> {
            try {
                // 1. 创建目标文件夹
                File destFolder = new File(path);
                if (!destFolder.exists()) destFolder.mkdirs();

                // 2. OkHttp 下载文件（完整浏览器伪装 + 防盗链 Referer）
                // 腾讯云 COS 要求 Referer 头，否则 CDN/WAF 返回 502
                java.net.URI uri = new java.net.URI(targetUrl);
                String referer = uri.getScheme() + "://" + uri.getHost() + "/";

                okhttp3.OkHttpClient client = new okhttp3.OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .proxy(java.net.Proxy.NO_PROXY) // 🚀 核心杀手锏：强制 App 走物理直连，无视 Knox 等任何系统级 VPN 和代理！
                    .build();

                okhttp3.Request request = new okhttp3.Request.Builder()
                    .url(targetUrl)
                    .addHeader("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
                    .addHeader("Accept", "*/*")
                    .addHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                    .addHeader("Cache-Control", "no-cache")
                    .build();
                okhttp3.Response response = client.newCall(request).execute();

                if (!response.isSuccessful()) {
                    call.reject("下载 ZIP 失败: " + response.code());
                    return;
                }

                // 3. 流式写入临时 zip 文件（避免大文件 OOM）
                File zipFile = new File(getContext().getCacheDir(), "update.zip");
                java.io.InputStream inputStream = response.body().byteStream();
                FileOutputStream fos = new FileOutputStream(zipFile);
                byte[] downloadBuffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = inputStream.read(downloadBuffer)) != -1) {
                    fos.write(downloadBuffer, 0, bytesRead);
                }
                fos.close();
                inputStream.close();
                Log.e(TAG, "ZIP 下载完成，准备原生解压...");

                // 4. 原生 Java 解压 Zip 到目标沙盒路径
                ZipFile zFile = new ZipFile(zipFile);
                Enumeration<? extends ZipEntry> entries = zFile.entries();
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    File entryFile = new File(destFolder, entry.getName());
                    if (entry.isDirectory()) {
                        entryFile.mkdirs();
                    } else {
                        entryFile.getParentFile().mkdirs();
                        InputStream is = zFile.getInputStream(entry);
                        FileOutputStream out = new FileOutputStream(entryFile);
                        byte[] buffer = new byte[4096];
                        int len;
                        while ((len = is.read(buffer)) > 0) {
                            out.write(buffer, 0, len);
                        }
                        out.close();
                        is.close();
                    }
                }
                zFile.close();
                Log.e(TAG, "原生解压完成！物理路径: " + destFolder.getAbsolutePath());

                // 5. 激活拦截器并重载 WebView
                MainActivity.snapshotBasePath = path;
                bridge.setServerBasePath(path);

                getActivity().runOnUiThread(() -> {
                    WebView webView = bridge.getWebView();
                    webView.clearCache(true);
                    webView.loadUrl("https://localhost/");
                    Log.e(TAG, "WebView 刷新成功，新版本已物理接管！");
                });

                call.resolve();

            } catch (Exception e) {
                Log.e(TAG, "真实下载解压流程崩溃", e);
                call.reject(e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("缺少 apkUrl 参数");
            return;
        }

        final String finalUrl = apkUrl.trim();

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

                // 2. 复用 OkHttp 防御链路
                java.net.URI uri = new java.net.URI(finalUrl);
                String referer = uri.getScheme() + "://" + uri.getHost() + "/";

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

                // 3. 流式写入 APK 文件（直接管道流写入，避免大文件 OOM）
                // 智能流式解密：根据前端参数决定是否解密前4字节的0x5A异或混淆
                boolean isXorEncrypted = call.getBoolean("isXorEncrypted", false);
                java.io.InputStream inputStream = response.body().byteStream();
                FileOutputStream fos = new FileOutputStream(apkFile);
                byte[] buffer = new byte[8192];
                int bytesRead;
                int offset = 0; // 全局字节偏置计数器，防止 OkHttp TCP 分包对齐失效
                long totalBytesRead = 0;
                int lastProgress = -1;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    if (isXorEncrypted) {
                        for (int i = 0; i < bytesRead && offset < 4; i++, offset++) {
                            buffer[i] = (byte) (buffer[i] ^ 0x5A);
                        }
                    }
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