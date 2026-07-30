package com.hydro.geekterminal;

import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.webClick;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.os.Environment;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.espresso.web.webdriver.Locator;
import androidx.test.uiautomator.UiDevice;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class StoreScreenshotInstrumentedTest {
    private static final long UI_TIMEOUT_MS = 15_000;

    @Test
    public void captureRealHomeFlowAndLevelingScreens() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.wakeUp();
        device.executeShellCommand("wm dismiss-keyguard");
        device.executeShellCommand("input keyevent 82");
        device.executeShellCommand("wm size 1080x1920");
        device.executeShellCommand("wm density 420");
        device.executeShellCommand("mkdir -p /sdcard/hydro-store-screenshots");

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            onWebView().forceJavascriptEnabled();
            waitForRoute(scenario, "home-screen");
            captureScreenshot(scenario, device, "01-home.png");

            clickTestId("home-flow");
            waitForRoute(scenario, "flow-screen");
            captureScreenshot(scenario, device, "02-flow.png");
            device.pressBack();
            waitForRoute(scenario, "home-screen");

            clickTestId("home-leveling");
            waitForRoute(scenario, "leveling-screen");
            captureScreenshot(scenario, device, "03-leveling.png");
        } finally {
            device.setOrientationNatural();
            device.unfreezeRotation();
            device.executeShellCommand("wm size reset");
            device.executeShellCommand("wm density reset");
        }
    }

    private static void captureScreenshot(
        ActivityScenario<MainActivity> scenario,
        UiDevice device,
        String name
    ) throws Exception {
        // Route visibility precedes the end of Framer Motion transitions. Wait for
        // delayed child animations so store assets never capture a translucent frame.
        SystemClock.sleep(1_000);

        // aosp-atd may expose a black system framebuffer in headless mode. Render the
        // real live WebView instead, then move that PNG out through the debuggable app.
        // This keeps screenshot validation deterministic without fabricating UI data.
        AtomicReference<Bitmap> rendered = new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridgeWebView();
            int width = webView.getWidth();
            int height = webView.getHeight();
            if (width <= 0 || height <= 0) return;
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            webView.draw(canvas);
            rendered.set(bitmap);
        });

        Bitmap preview = rendered.get();
        assertTrue("无法取得商店截图位图：" + name, preview != null);
        int visibleSamples = 0;
        int darkSamples = 0;
        for (int y = 0; y < preview.getHeight(); y += Math.max(1, preview.getHeight() / 24)) {
            for (int x = 0; x < preview.getWidth(); x += Math.max(1, preview.getWidth() / 16)) {
                int color = preview.getPixel(x, y);
                int brightness = ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
                if (brightness > 24) visibleSamples++;
                if (brightness < 540) darkSamples++;
            }
        }
        assertTrue("商店截图为全黑画面：" + name, visibleSamples > 20);
        assertTrue("商店截图仍处于透明动画：" + name, darkSamples >= 4);

        Context targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
        values.put(
            MediaStore.MediaColumns.RELATIVE_PATH,
            Environment.DIRECTORY_PICTURES + "/HydroStore"
        );
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri screenshotUri = targetContext.getContentResolver().insert(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values
        );
        assertTrue("无法创建商店截图媒体项：" + name, screenshotUri != null);
        try (OutputStream output = targetContext.getContentResolver().openOutputStream(screenshotUri)) {
            assertTrue("无法打开商店截图输出流：" + name, output != null);
            assertTrue("商店截图PNG编码失败：" + name, preview.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally {
            preview.recycle();
        }

        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        targetContext.getContentResolver().update(screenshotUri, values, null, null);

        String path = "/sdcard/Pictures/HydroStore/" + name;
        String size = device.executeShellCommand("stat -c %s " + path).trim();
        assertTrue("商店截图为空：" + name + " size=" + size, size.matches("\\d+") && Long.parseLong(size) > 10_000L);
    }

    private static void clickTestId(String testId) {
        onWebView().withElement(findElement(Locator.CSS_SELECTOR, "[data-testid='" + testId + "']")).perform(webClick());
    }

    private static void waitForRoute(ActivityScenario<MainActivity> scenario, String testId) throws Exception {
        String expression = "(() => {const e=document.querySelector(\"[data-testid='" + testId + "']\");"
            + "if(!e)return false;let n=e;while(n){const s=getComputedStyle(n);"
            + "if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none'||parseFloat(s.opacity)<0.98)return false;n=n.parentElement;}return true;})()";
        waitForJavascript(scenario, expression, "截图页面未出现：" + testId);
    }

    private static void waitForJavascript(ActivityScenario<MainActivity> scenario, String expression, String message) throws Exception {
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        String lastValue = null;
        while (SystemClock.uptimeMillis() < deadline) {
            lastValue = evaluateJavascript(scenario, "Boolean(" + expression + ")");
            if ("true".equals(lastValue)) return;
            SystemClock.sleep(150);
        }
        throw new AssertionError(message + "；最后结果=" + lastValue);
    }

    private static String evaluateJavascript(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridgeWebView().evaluateJavascript(
            "(() => {try{return " + expression + ";}catch(error){return false;}})()",
            value -> { result.set(normalizeJavascriptValue(value)); latch.countDown(); }
        ));
        assertTrue("WebView JavaScript回调超时", latch.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static String normalizeJavascriptValue(String value) {
        if (value == null) return null;
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            return value.substring(1, value.length() - 1).replace("\\\"", "\"").replace("\\\\", "\\");
        }
        return value;
    }
}
