package com.hydro.geekterminal.plugin;

/**
 * SnapshotSystem configuration constants.
 * Minimal skeleton — values are placeholders for future COS integration.
 */
public final class SnapshotConfig {

    private SnapshotConfig() {
        /* constants only */
    }

    /** Snapshot root directory name under getFilesDir() */
    public static final String SNAPSHOT_DIR = "snapshots";

    /** Name of the current snapshot symlink / pointer */
    public static final String CURRENT_LINK = "current";

    /** Name of the previous snapshot symlink / pointer */
    public static final String PREVIOUS_LINK = "previous";

    /** SharedPreferences key for APK versionCode tracking */
    public static final String PREFS_LAST_APK_VERSION = "snapshot_last_apk_version";

    /** Test snapshot directory name (stage 2 verification only) */
    public static final String TEST_DIR = "test";
}