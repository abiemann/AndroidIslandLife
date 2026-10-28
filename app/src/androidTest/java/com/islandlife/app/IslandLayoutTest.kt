package com.islandlife.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class IslandLayoutTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun largeTextHeaderKeepsTitleAndFpsSeparate() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.setContent {
            CompositionLocalProvider(
                LocalDensity provides Density(LocalDensity.current.density, fontScale = 2f)
            ) {
                MaterialTheme {
                    Box(Modifier.requiredSize(320.dp, 480.dp)) {
                        IslandHeader(displayedFps = 30, frameRateLimit = 0, onFrameRateLimitChange = {})
                    }
                }
            }
        }

        val title = compose.onNodeWithText(context.getString(R.string.app_name)).assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        val fps = compose.onNodeWithText(
            context.getString(R.string.fps_value, 30)
        ).assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Large title must not overlap the FPS label", title.right <= fps.left)
        assertTrue("Title must retain visible width", title.width > 0)
    }

    @Test
    fun retryCanBeScrolledIntoViewAndClickedInShortWindow() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var retries = 0
        compose.setContent {
            CompositionLocalProvider(
                LocalDensity provides Density(LocalDensity.current.density, fontScale = 2f)
            ) {
                MaterialTheme {
                    Box(Modifier.requiredSize(320.dp, 180.dp)) {
                        SceneStatus(failed = true, onRetry = { retries++ })
                    }
                }
            }
        }

        compose.onNodeWithText(context.getString(R.string.retry))
            .performScrollTo()
            .assertIsDisplayed()
            .performClick()
        compose.runOnIdle { assertEquals("Retry action must remain usable", 1, retries) }
    }

    @Test
    fun fpsButtonOffersAllLimitsAndMarksTheSelectedChoice() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var selectedLimit by mutableIntStateOf(0)
        val measuredFps = context.getString(R.string.fps_value, 37)
        val buttonDescription = context.getString(R.string.frame_rate_button_description, measuredFps)
        val unlocked = context.getString(R.string.frame_rate_unlocked)
        compose.setContent {
            MaterialTheme {
                IslandHeader(
                    displayedFps = 37,
                    frameRateLimit = selectedLimit,
                    onFrameRateLimitChange = { selectedLimit = it }
                )
            }
        }

        compose.onNodeWithContentDescription(buttonDescription).performClick()
        compose.onNodeWithText(unlocked).assertIsSelected()
        compose.onNodeWithText(context.getString(R.string.fps_value, 30)).assertIsNotSelected()
        compose.onNodeWithText(context.getString(R.string.fps_value, 60)).assertIsNotSelected()
        for (limit in listOf(60, 30, 0)) {
            val label = if (limit == 0) unlocked else context.getString(R.string.fps_value, limit)
            compose.onNodeWithText(label).performClick()
            compose.runOnIdle { assertEquals(limit, selectedLimit) }
            compose.onNodeWithText(measuredFps).assertIsDisplayed()
            compose.onNodeWithContentDescription(buttonDescription).performClick()
            compose.onNodeWithText(label).assertIsSelected()
        }
    }

    @Test
    fun weatherToggleStaysLeftOfRecenterAndPreservesLighting() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var stormy by mutableStateOf(false)
        var golden by mutableStateOf(false)
        var recenterCount = 0
        compose.setContent {
            MaterialTheme {
                Box(Modifier.requiredSize(379.dp, 160.dp)) {
                    IslandControls(
                        paused = false,
                        golden = golden,
                        stormy = stormy,
                        onTogglePause = {},
                        onToggleLighting = { golden = !golden },
                        onToggleWeather = { stormy = !stormy },
                        onRecenter = { recenterCount++ }
                    )
                }
            }
        }

        val stormLabel = context.getString(R.string.storm)
        val sunLabel = context.getString(R.string.sun)
        val recenterLabel = context.getString(R.string.recenter)
        val stormBounds = compose.onNodeWithText(stormLabel).assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        val recenterBounds = compose.onNodeWithText(recenterLabel).assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Storm must be immediately left of Recenter", stormBounds.right <= recenterBounds.left)
        assertEquals("Storm and Recenter must share a row", stormBounds.center.y, recenterBounds.center.y, 1f)
        compose.onNodeWithText(stormLabel).assert(
            SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription,
                context.getString(R.string.weather_sunny)
            )
        ).performClick()
        compose.onNodeWithText(sunLabel).assert(
            SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription,
                context.getString(R.string.weather_stormy)
            )
        ).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.golden_light)).performClick()
        compose.runOnIdle {
            assertTrue("Lighting selection must remain independent from storm", golden && stormy)
        }
        compose.onNodeWithText(sunLabel).performClick()
        compose.onNodeWithText(stormLabel).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.daylight)).assertIsDisplayed()
        compose.runOnIdle {
            assertTrue("Returning to sun must preserve golden light", golden && !stormy)
        }
        compose.onNodeWithText(recenterLabel).performClick()
        compose.runOnIdle { assertEquals(1, recenterCount) }
    }
}
