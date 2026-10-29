package com.islandlife.app

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

private const val FRAME_RATE_LIMIT_KEY = "frame_rate_limit"
private val frameRateLimits = listOf(30, 60, 0)
private val overlayEdgePadding = 24.dp

@Composable
internal fun IslandScreen() {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("island_settings", Context.MODE_PRIVATE)
    }
    var frameRateLimit by rememberSaveable {
        mutableIntStateOf(
            preferences.getInt(FRAME_RATE_LIMIT_KEY, 0).takeIf {
                it in frameRateLimits
            } ?: 0
        )
    }
    var paused by rememberSaveable { mutableStateOf(false) }
    var golden by rememberSaveable { mutableStateOf(false) }
    var stormy by rememberSaveable { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var loaded by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var fps by remember { mutableStateOf<Double?>(null) }
    var scene by remember { mutableStateOf<IslandWebView?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val windowSize = LocalWindowInfo.current.containerSize
    val landscape = windowSize.width > windowSize.height

    LaunchedEffect(attempt, loaded, failure, lifecycle) {
        if (!loaded && failure == null) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                delay(45_000)
                failure = "The scene took too long to initialize."
            }
        }
    }

    DisposableEffect(lifecycle, scene) {
        val currentScene = scene
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> currentScene?.setSceneActive(true)
                Lifecycle.Event.ON_PAUSE -> currentScene?.setSceneActive(false)
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        currentScene?.setSceneActive(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose {
            lifecycle.removeObserver(observer)
            currentScene?.setSceneActive(false)
        }
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF176F79))) {
        key(attempt) {
            AndroidView(
                factory = { context ->
                    IslandWebView(
                        context,
                        onReady = {
                            loaded = true
                            failure = null
                        },
                        onFailure = {
                            failure = it
                            loaded = false
                        },
                        onFps = { fps = it }
                    ).also { scene = it }
                },
                modifier = Modifier.fillMaxSize(),
                update = { it.setSceneOptions(paused, golden, stormy, frameRateLimit) },
                onRelease = { it.disposeScene() }
            )
        }
        Box(
            Modifier.fillMaxWidth().height(210.dp).background(
                Brush.verticalGradient(listOf(Color(0x880B404A), Color.Transparent))
            )
        )
        IslandHeader(
            displayedFps = if (!loaded ||
                failure != null
            ) {
                null
            } else if (paused) {
                0
            } else {
                fps?.roundToInt()
            },
            frameRateLimit = frameRateLimit,
            onFrameRateLimitChange = {
                frameRateLimit = it
                preferences.edit { putInt(FRAME_RATE_LIMIT_KEY, it) }
            },
            modifier = Modifier.align(Alignment.TopCenter)
        )
        if (loaded && failure == null) {
            IslandFooter(
                landscape = landscape,
                modifier = Modifier.align(Alignment.BottomCenter)
            ) { controlsModifier ->
                IslandControls(
                    paused = paused,
                    golden = golden,
                    stormy = stormy,
                    onTogglePause = { paused = !paused },
                    onToggleLighting = { golden = !golden },
                    onToggleWeather = { stormy = !stormy },
                    onRecenter = { scene?.recenter() },
                    modifier = controlsModifier
                )
            }
        }
        if (!loaded || failure != null) {
            SceneStatus(
                failed = failure != null,
                onRetry = {
                    failure = null
                    loaded = false
                    fps = null
                    attempt++
                },
                modifier = Modifier.align(Alignment.Center)
            )
        }
    }
}

@Composable
private fun IslandFooter(landscape: Boolean, modifier: Modifier = Modifier, controls: @Composable (Modifier) -> Unit) {
    if (landscape) {
        Row(
            modifier.fillMaxWidth().safeDrawingPadding()
                .padding(start = 16.dp, top = 16.dp, end = overlayEdgePadding, bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            controls(Modifier.weight(0.6f, fill = false))
            Spacer(Modifier.width(16.dp))
            GestureHint(Modifier.weight(0.4f, fill = false))
        }
    } else {
        Column(
            modifier.safeDrawingPadding().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            GestureHint()
            Spacer(Modifier.height(10.dp))
            controls(Modifier)
        }
    }
}

@Composable
private fun GestureHint(modifier: Modifier = Modifier) {
    Surface(modifier, color = Color(0xD9194F55), shape = RoundedCornerShape(20.dp)) {
        Text(
            stringResource(R.string.gesture_hint),
            Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            textAlign = TextAlign.Center,
            color = Color.White,
            style = MaterialTheme.typography.labelMedium
        )
    }
}

@Composable
internal fun IslandControls(
    paused: Boolean,
    golden: Boolean,
    stormy: Boolean,
    onTogglePause: () -> Unit,
    onToggleLighting: () -> Unit,
    onToggleWeather: () -> Unit,
    onRecenter: () -> Unit,
    modifier: Modifier = Modifier
) {
    val weatherDescription = stringResource(
        if (stormy) R.string.weather_stormy else R.string.weather_sunny
    )
    Surface(
        modifier = modifier,
        color = Color(0xF5F8F6EC),
        shape = RoundedCornerShape(28.dp),
        shadowElevation = 4.dp
    ) {
        FlowRow(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.Center
        ) {
            TextButton(onClick = onTogglePause) {
                Text(stringResource(if (paused) R.string.play else R.string.pause))
            }
            FilledTonalButton(onClick = onToggleLighting) {
                Text(stringResource(if (golden) R.string.daylight else R.string.golden_light))
            }
            Row {
                TextButton(
                    onClick = onToggleWeather,
                    modifier = Modifier.semantics { stateDescription = weatherDescription }
                ) {
                    Text(stringResource(if (stormy) R.string.sun else R.string.storm))
                }
                TextButton(onClick = onRecenter) {
                    Text(stringResource(R.string.recenter))
                }
            }
        }
    }
}

@Composable
internal fun IslandHeader(
    displayedFps: Int?,
    frameRateLimit: Int,
    onFrameRateLimitChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var frameRateMenuExpanded by remember { mutableStateOf(false) }
    val fpsText = if (displayedFps == null) {
        stringResource(R.string.fps_waiting)
    } else {
        stringResource(R.string.fps_value, displayedFps)
    }
    val limitText = if (frameRateLimit == 0) {
        stringResource(R.string.frame_rate_unlocked)
    } else {
        stringResource(R.string.fps_value, frameRateLimit)
    }
    val buttonDescription = stringResource(R.string.frame_rate_button_description, fpsText)
    val limitDescription = stringResource(R.string.frame_rate_limit_description, limitText)
    Row(
        modifier.fillMaxWidth().safeDrawingPadding().padding(overlayEdgePadding),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.Top
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(R.string.app_name),
                color = Color(0xFFFFFAEA),
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.Normal,
                fontSize = 34.sp,
                letterSpacing = (-0.6).sp
            )
            Text(
                stringResource(R.string.tagline),
                color = Color(0xFFEDF5E8),
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Box(Modifier.padding(top = 4.dp)) {
            TextButton(
                onClick = { frameRateMenuExpanded = true },
                modifier = Modifier.semantics {
                    contentDescription = buttonDescription
                    stateDescription = limitDescription
                },
                colors = ButtonDefaults.textButtonColors(
                    containerColor = Color(0xD9194F55),
                    contentColor = Color.White
                ),
                shape = RoundedCornerShape(16.dp)
            ) {
                Text(
                    fpsText,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.labelMedium
                )
            }
            DropdownMenu(
                expanded = frameRateMenuExpanded,
                onDismissRequest = { frameRateMenuExpanded = false }
            ) {
                frameRateLimits.forEach { limit ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                if (limit == 0) {
                                    stringResource(R.string.frame_rate_unlocked)
                                } else {
                                    stringResource(R.string.fps_value, limit)
                                }
                            )
                        },
                        onClick = {
                            onFrameRateLimitChange(limit)
                            frameRateMenuExpanded = false
                        },
                        leadingIcon = {
                            RadioButton(selected = frameRateLimit == limit, onClick = null)
                        },
                        modifier = Modifier.semantics { selected = frameRateLimit == limit }
                    )
                }
            }
        }
    }
}

@Composable
internal fun SceneStatus(failed: Boolean, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier.safeDrawingPadding().padding(24.dp).widthIn(max = 360.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(24.dp),
        color = Color(0xF5F8F6EC)
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            if (failed) {
                Text(
                    stringResource(R.string.error_title),
                    style = MaterialTheme.typography.titleLarge
                )
                Text(stringResource(R.string.error_help), textAlign = TextAlign.Center)
                Button(onClick = onRetry) {
                    Text(stringResource(R.string.retry))
                }
            } else {
                CircularProgressIndicator()
                Text(stringResource(R.string.loading))
            }
        }
    }
}
