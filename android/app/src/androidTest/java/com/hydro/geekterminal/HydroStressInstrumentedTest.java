package com.hydro.geekterminal;

import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.webClick;
import static org.junit.Assert.assertTrue;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Debug;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.espresso.web.webdriver.Locator;
import androidx.test.uiautomator.UiDevice;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class HydroStressInstrumentedTest {
    private static final long UI_TIMEOUT_MS = 20_000;

    @Test
    public void repeatedNavigationPersistenceAndRecreationStayBounded() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.executeShellCommand("wm size 390x844");
        device.executeShellCommand("wm density 160");

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            onWebView().forceJavascriptEnabled();
            waitForRoute(scenario, "home-screen");
            int baselinePssKb = currentPssKb(scenario);
            int peakPssKb = baselinePssKb;

            for (int index = 0; index < 25; index++) {
                clickTestId("home-flow");
                waitForRoute(scenario, "flow-screen");
                device.pressBack();
                waitForRoute(scenario, "home-screen");

                clickTestId("home-leveling");
                waitForRoute(scenario, "leveling-screen");
                device.pressBack();
                waitForRoute(scenario, "home-screen");

                if ((index + 1) % 5 == 0) {
                    scenario.recreate();
                    waitForRoute(scenario, "home-screen");
                }
                peakPssKb = Math.max(peakPssKb, currentPssKb(scenario));
            }

            clickTestId("home-flow");
            waitForRoute(scenario, "flow-screen");
            clickTestId("flow-add-vertical");
            waitForJavascript(scenario, "document.querySelector(\"[data-testid='flow-velocity-input']\") !== null", "压力测试流速输入未渲染");
            String finalVelocity = "39.123456";
            for (int index = 0; index < 40; index++) {
                setReactInput(scenario, "flow-velocity-input", index + ".123456");
                SystemClock.sleep(25);
            }
            waitForJavascript(scenario, "document.querySelector(\"[data-testid='flow-velocity-input']\").value === '" + finalVelocity + "'", "高频流速输入最终状态错误");

            scenario.recreate();
            waitForRoute(scenario, "home-screen");
            clickTestId("home-flow");
            waitForRoute(scenario, "flow-screen");
            waitForJavascript(scenario, "document.querySelector(\"[data-testid='flow-velocity-input']\").value === '" + finalVelocity + "'", "压力重建后流速数据丢失");

            Runtime.getRuntime().gc();
            SystemClock.sleep(1_500);
            int finalPssKb = currentPssKb(scenario);
            assertTrue("压力测试峰值PSS超过384MB：" + peakPssKb + "KB", peakPssKb < 384 * 1024);
            assertTrue("压力测试结束PSS相对基线增长超过160MB：baseline=" + baselinePssKb + "KB final=" + finalPssKb + "KB", finalPssKb - baselinePssKb < 160 * 1024);
        } finally {
            device.setOrientationNatural();
            device.unfreezeRotation();
            device.executeShellCommand("wm size reset");
            device.executeShellCommand("wm density reset");
        }
    }

    private static int currentPssKb(ActivityScenario<MainActivity> scenario) {
        AtomicInteger pss = new AtomicInteger();
        scenario.onActivity(activity -> {
            ActivityManager manager = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
            Debug.MemoryInfo[] memory = manager.getProcessMemoryInfo(new int[] { android.os.Process.myPid() });
            pss.set(memory.length == 0 ? 0 : memory[0].getTotalPss());
        });
        return pss.get();
    }

    private static void clickTestId(String testId) {
        onWebView().withElement(findElement(Locator.CSS_SELECTOR, "[data-testid='" + testId + "']")).perform(webClick());
    }

    private static void setReactInput(ActivityScenario<MainActivity> scenario, String testId, String value) throws Exception {
        String expression = "(() => {const e=document.querySelector(\"[data-testid='" + testId + "']\");"
            + "if(!e)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"
            + "setter.call(e,'" + value + "');e.dispatchEvent(new Event('input',{bubbles:true}));"
            + "e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()";
        waitForJavascript(scenario, expression, "React压力输入控件不可用：" + testId);
    }

    private static void waitForRoute(ActivityScenario<MainActivity> scenario, String testId) throws Exception {
        String expression = "(() => {const e=document.querySelector(\"[data-testid='" + testId + "']\");"
            + "if(!e)return false;let n=e;while(n){const s=getComputedStyle(n);"
            + "if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none')return false;n=n.parentElement;}return true;})()";
        waitForJavascript(scenario, expression, "压力页面未出现：" + testId);
    }

    private static void waitForJavascript(ActivityScenario<MainActivity> scenario, String expression, String message) throws Exception {
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        String lastValue = null;
        while (SystemClock.uptimeMillis() < deadline) {
            lastValue = evaluateJavascript(scenario, "Boolean(" + expression + ")");
            if ("true".equals(lastValue)) return;
            SystemClock.sleep(100);
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
