package com.hydro.geekterminal;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.hydro.geekterminal.plugin.SnapshotPlugin;
import java.io.File;
import java.io.FileInputStream;
import android.util.Log;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends BridgeActivity {

    // 暴露给前端 Plugin 调用的静态变量，用于动态切换路径
    public static String snapshotBasePath = null;

    /** Read-only test/accessibility surface; keeps Bridge ownership inside Activity. */
    public WebView getBridgeWebView() {
        return this.bridge.getWebView();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom SnapshotPlugin before the bridge is created
        registerPlugin(SnapshotPlugin.class);
        super.onCreate(savedInstanceState);
        installSystemBarInsets();
    }

    /**
     * Android 16 enforces edge-to-edge for targetSdk 36. Keep the WebView background
     * immersive while moving interactive web content below status bars and display
     * cutouts. The handled system-bar insets are consumed so CSS safe-area values
     * do not add the same space a second time.
     */
    private void installSystemBarInsets() {
        WebView webView = this.bridge.getWebView();
        final int initialLeft = webView.getPaddingLeft();
        final int initialTop = webView.getPaddingTop();
        final int initialRight = webView.getPaddingRight();
        final int initialBottom = webView.getPaddingBottom();

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets statusBars = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets displayCutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets navigationBars = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());

            int safeLeft = Math.max(Math.max(statusBars.left, displayCutout.left), navigationBars.left);
            int safeTop = Math.max(statusBars.top, displayCutout.top);
            int safeRight = Math.max(Math.max(statusBars.right, displayCutout.right), navigationBars.right);
            int safeBottom = Math.max(displayCutout.bottom, navigationBars.bottom);

            view.setPadding(
                initialLeft + safeLeft,
                initialTop + safeTop,
                initialRight + safeRight,
                initialBottom + safeBottom
            );

            return new WindowInsetsCompat.Builder(windowInsets)
                .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(webView);
    }

    @Override
    public void onStart() {
        super.onStart();

        WebView webView = this.bridge.getWebView();

        // ⭐ 核心修复：直接继承并实例化 BridgeWebViewClient，绝不动 node_modules
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                boolean isMainFrame = request.isForMainFrame();

                if (isMainFrame) {
                    Log.e("NAV_TRACE", "URL=" + url + " isMainFrame=true");
                }

                // ⭐ 精准狙击 Main Frame
                if (isMainFrame && snapshotBasePath != null &&
                    (url.equals("https://localhost/") || url.equals("https://localhost/index.html"))) {

                    try {
                        File index = new File(snapshotBasePath, "index.html");

                        if (index.exists()) {
                            Log.e("SNAPSHOT_TRACE", "MAIN_FRAME_OVERRIDE=" + index.getAbsolutePath());
                            // 物理替换响应流
                            return new WebResourceResponse("text/html", "UTF-8", new FileInputStream(index));
                        }
                    } catch (Exception e) {
                        Log.e("SNAPSHOT_TRACE", "MAIN_FRAME_FAIL", e);
                    }
                }

                // ⭐ 关键兜底：交给 Capacitor 原生逻辑处理 Assets 和 API
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
