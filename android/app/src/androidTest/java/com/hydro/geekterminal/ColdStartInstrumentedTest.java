package com.hydro.geekterminal;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ColdStartInstrumentedTest {

    @Test
    public void packageAndVersionMatchSmokeVariant() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.hydro.geekterminal.smoke", context.getPackageName());
        PackageInfo packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        assertTrue("versionCode 必须为正整数", packageInfo.getLongVersionCode() > 0);
        assertTrue("versionName 必须为语义版本", packageInfo.versionName != null
            && packageInfo.versionName.matches("\\d+\\.\\d+\\.\\d+"));
    }

    @Test
    public void coldStartShowsCapacitorWebView() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> assertTrue("Activity 不应结束", !activity.isFinishing()));
            onView(isAssignableFrom(WebView.class)).check(matches(isDisplayed()));
        }
    }
}
