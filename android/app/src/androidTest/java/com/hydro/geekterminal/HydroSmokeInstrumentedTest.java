package com.hydro.geekterminal;

import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.webClick;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import androidx.test.espresso.web.webdriver.Locator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class HydroSmokeInstrumentedTest {
    private static final String TARGET_PACKAGE = "com.hydro.geekterminal.smoke";
    private static final long UI_TIMEOUT_MS = 15_000;

    @Test
    public void fullOfflineSafeAreaPersistenceAndShareJourney() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.executeShellCommand("wm size 320x568");
        device.executeShellCommand("wm density 160");

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            onWebView().forceJavascriptEnabled();
            waitForRoute(scenario, "home-screen");
            assertViewportHasNoOverflow(scenario, 320);
            assertSystemBarInsetsApplied(scenario);

            clickTestId("home-flow");
            waitForRoute(scenario, "flow-screen");
            assertViewportHasNoOverflow(scenario, 320);
            device.pressBack();
            waitForRoute(scenario, "home-screen");

            clickTestId("home-leveling");
            waitForRoute(scenario, "leveling-screen");
            assertViewportHasNoOverflow(scenario, 320);
            device.pressBack();
            waitForRoute(scenario, "home-screen");

            clickTestId("home-app-info");
            waitForRoute(scenario, "app-info-screen");
            assertViewportHasNoOverflow(scenario, 320);
            waitForJavascript(
                scenario,
                "document.querySelector(\"[data-testid='privacy-section']\") !== null && document.querySelector(\"[data-testid='agreement-section']\") !== null",
                "隐私政策或用户协议未渲染"
            );
            device.pressBack();
            waitForRoute(scenario, "home-screen");

            device.setOrientationLeft();
            waitForJavascript(scenario, "window.innerWidth > window.innerHeight", "横屏未生效");
            assertViewportHasNoOverflow(scenario, null);
            device.setOrientationNatural();
            waitForJavascript(scenario, "window.innerWidth < window.innerHeight", "竖屏未恢复");

            device.executeShellCommand("svc wifi disable");
            device.executeShellCommand("svc data disable");
            scenario.recreate();
            waitForRoute(scenario, "home-screen");
            assertViewportHasNoOverflow(scenario, 320);

            clickTestId("home-governance");
            waitForRoute(scenario, "governance-screen");
            String actor = "Android-Smoke-Operator";
            setReactInput(scenario, "governance-actor", actor);
            waitForJavascript(
                scenario,
                "document.querySelector(\"[data-testid='governance-actor']\").value === '" + actor + "'",
                "治理人员输入未写入"
            );
            evaluateJavascript(
                scenario,
                "(() => {window.__smokeActorPersisted=false;const p=window.Capacitor?.Plugins?.Preferences;"
                    + "if(!p)return false;p.get({key:'hydro-governance'}).then(r=>{window.__smokeActorPersisted=Boolean(r.value&&r.value.includes('" + actor + "'));})"
                    + ".catch(()=>{window.__smokeActorPersisted=false;});return true;})()"
            );
            waitForJavascript(scenario, "window.__smokeActorPersisted === true", "治理人员未写入 Capacitor Preferences");

            scenario.recreate();
            waitForRoute(scenario, "home-screen");
            clickTestId("home-governance");
            waitForRoute(scenario, "governance-screen");
            waitForJavascript(
                scenario,
                "document.querySelector(\"[data-testid='governance-actor']\").value === '" + actor + "'",
                "Activity 重建后治理人员未恢复"
            );

            clickTestId("backup-export");
            boolean resolverVisible = device.wait(Until.hasObject(By.pkg("com.android.intentresolver")), 8_000);
            String foregroundPackage = device.getCurrentPackageName();
            assertTrue(
                "完整备份未唤起 Android 分享面板；当前包=" + foregroundPackage,
                resolverVisible || (foregroundPackage != null && !TARGET_PACKAGE.equals(foregroundPackage))
            );
            device.pressBack();
            waitForRoute(scenario, "governance-screen");
        } finally {
            device.executeShellCommand("svc wifi enable");
            device.executeShellCommand("svc data enable");
            device.setOrientationNatural();
            device.unfreezeRotation();
            device.executeShellCommand("wm size reset");
            device.executeShellCommand("wm density reset");
        }
    }

    private static void clickTestId(String testId) {
        onWebView().withElement(findElement(Locator.CSS_SELECTOR, "[data-testid='" + testId + "']"))
            .perform(webClick());
    }

    private static void setReactInput(ActivityScenario<MainActivity> scenario, String testId, String value) throws Exception {
        String expression = "(() => {const e=document.querySelector(\"[data-testid='" + testId + "']\");"
            + "if(!e)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"
            + "setter.call(e,'" + value + "');e.dispatchEvent(new Event('input',{bubbles:true}));"
            + "e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()";
        waitForJavascript(scenario, expression, "React 输入控件不可用：" + testId);
    }

    private static void waitForRoute(ActivityScenario<MainActivity> scenario, String testId) throws Exception {
        String expression = "(() => { const e=document.querySelector(\"[data-testid='" + testId + "']\");"
            + "if(!e)return false;let n=e;while(n){const s=getComputedStyle(n);"
            + "if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none')return false;n=n.parentElement;}"
            + "return true;})()";
        try {
            waitForJavascript(scenario, expression, "页面未出现：" + testId);
        } catch (AssertionError error) {
            String diagnostic = evaluateJavascript(
                scenario,
                "JSON.stringify({ready:document.readyState,url:location.href,exists:Boolean(document.querySelector(\"[data-testid='" + testId + "']\")),body:(document.body?.innerText||'').slice(0,80)})"
            );
            throw new AssertionError(error.getMessage() + "；DOM=" + diagnostic, error);
        }
    }

    private static void assertViewportHasNoOverflow(ActivityScenario<MainActivity> scenario, Integer expectedWidth) throws Exception {
        waitForJavascript(
            scenario,
            "document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth",
            "页面存在横向溢出"
        );
        if (expectedWidth != null) {
            String width = evaluateJavascript(scenario, "String(window.innerWidth)");
            assertEquals("模拟宽度必须精确进入 320px 验收档", expectedWidth.toString(), width);
        }
    }

    private static void assertSystemBarInsetsApplied(ActivityScenario<MainActivity> scenario) {
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridgeWebView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
            assertNotNull("WebView 必须取得系统栏 Insets", insets);
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout());
            assertTrue(
                "WebView 顶部安全区不足：padding=" + webView.getPaddingTop() + ", inset=" + systemBars.top,
                webView.getPaddingTop() >= systemBars.top
            );
            if (systemBars.top == 0) {
                int syntheticStatusBar = 24;
                WindowInsetsCompat syntheticInsets = new WindowInsetsCompat.Builder(insets)
                    .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, syntheticStatusBar, 0, 0))
                    .build();
                ViewCompat.dispatchApplyWindowInsets(webView, syntheticInsets);
                assertTrue(
                    "合成状态栏 Insets 未下移 WebView 内容",
                    webView.getPaddingTop() >= syntheticStatusBar
                );
                ViewCompat.requestApplyInsets(webView);
            }
        });
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
            "(() => { try { return " + expression + "; } catch (error) { return false; } })()",
            value -> {
                result.set(normalizeJavascriptValue(value));
                latch.countDown();
            }
        ));
        assertTrue("WebView JavaScript 回调超时", latch.await(5, TimeUnit.SECONDS));
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
