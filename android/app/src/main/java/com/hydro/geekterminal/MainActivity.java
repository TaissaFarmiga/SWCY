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

public class MainActivity extends BridgeActivity {

    // 暴露给前端 Plugin 调用的静态变量，用于动态切换路径
    public static String snapshotBasePath = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom SnapshotPlugin before the bridge is created
        registerPlugin(SnapshotPlugin.class);
        super.onCreate(savedInstanceState);
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
