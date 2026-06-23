package com.hydro.geekterminal.plugin;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.pm.PackageInfoCompat;

import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

/**
 * SnapshotManager — file-system level snapshot bookkeeping.
 */
public class SnapshotManager {

    private final Context context;

    public SnapshotManager(Context context) {
        this.context = context;
    }

    /**
     * Get the root snapshot directory.
     */
    public File getSnapshotRoot() {
        return new File(context.getFilesDir(), SnapshotConfig.SNAPSHOT_DIR);
    }

    /**
     * Get path to the test snapshot directory.
     */
    public File getTestDir() {
        return new File(getSnapshotRoot(), SnapshotConfig.TEST_DIR);
    }

    /**
     * Get the APK version string (versionName).
     */
    public String getApkVersion() {
        try {
            PackageManager pm = context.getPackageManager();
            PackageInfo info = pm.getPackageInfo(context.getPackageName(), 0);
            return info.versionName != null ? info.versionName : "";
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    /**
     * Get the APK version code (long, safe form).
     */
    public long getApkVersionCode() {
        try {
            PackageManager pm = context.getPackageManager();
            PackageInfo info = pm.getPackageInfo(context.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return info.getLongVersionCode();
            } else {
                return PackageInfoCompat.getLongVersionCode(info);
            }
        } catch (PackageManager.NameNotFoundException e) {
            return -1;
        }
    }

    /**
     * Check whether the APK has been upgraded since last recorded version.
     */
    public boolean isApkUpgraded() {
        long current = getApkVersionCode();
        SharedPreferences prefs = context.getSharedPreferences(
            SnapshotConfig.PREFS_LAST_APK_VERSION,
            Context.MODE_PRIVATE
        );
        long stored = prefs.getLong("version_code", -1);
        return stored != -1 && current != stored;
    }

    /**
     * Persist the current APK version code to SharedPreferences.
     */
    public void recordApkVersionCode() {
        long current = getApkVersionCode();
        SharedPreferences prefs = context.getSharedPreferences(
            SnapshotConfig.PREFS_LAST_APK_VERSION,
            Context.MODE_PRIVATE
        );
        prefs.edit().putLong("version_code", current).apply();
    }

    /**
     * Create test snapshot directory with index.html.
     *
     * @return absolute path to the test directory, or null on failure
     */
    public String createTestSnapshot() {
        File testDir = getTestDir();
        testDir.mkdirs();
        if (!testDir.exists()) return null;

        File indexHtml = new File(testDir, "index.html");
        try (FileWriter writer = new FileWriter(indexHtml)) {
            writer.write(
                "<!DOCTYPE html>\n" +
                "<html>\n" +
                "<head>\n" +
                "<meta charset=\"utf-8\">\n" +
                "<title>SNAPSHOT TEST</title>\n" +
                "</head>\n" +
                "<body style=\"background:black;color:#00ff00;padding:30px;\">\n" +
                "<h1>SNAPSHOT WORKS</h1>\n" +
                "<p>BUILD_SOURCE=FILESYSTEM</p>\n" +
                "<p>TIMESTAMP=PHASE2_VERIFY</p>\n" +
                "<script>\n" +
                "console.log(\"SNAPSHOT HTML LOADED\");\n" +
                "console.log(\"URL=\", location.href);\n" +
                "document.body.insertAdjacentHTML('beforeend', '<p>URL=' + location.href + '</p>');\n" +
                "</script>\n" +
                "</body>\n" +
                "</html>\n"
            );
            writer.flush();
        } catch (IOException e) {
            testDir.delete();
            return null;
        }

        Log.i("SnapshotManager", "snapshot index exists = " + indexHtml.exists());
        Log.i("SnapshotManager", "snapshot index size  = " + indexHtml.length());

        return testDir.getAbsolutePath();
    }

    /**
     * Read the test snapshot index.html content.
     *
     * @return { exists: boolean, size: long, content: string }
     */
    public String readTestSnapshotContent() {
        File indexHtml = new File(getTestDir(), "index.html");
        if (!indexHtml.exists()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new FileReader(indexHtml))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
        } catch (IOException e) {
            return null;
        }
        return sb.toString();
    }
}