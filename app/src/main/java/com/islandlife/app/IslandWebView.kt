package com.islandlife.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

private const val SCENE_URL = "https://appassets.androidplatform.net/assets/scene/index.html"

/**
 * Hosts only bundled scene assets. The bridge exposes no device or filesystem capabilities.
 * Created exclusively by AndroidView, so an XML layout-editor constructor is unnecessary.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
internal class IslandWebView(
    context: Context,
    private val onReady: () -> Unit,
    private val onFailure: (String) -> Unit,
    private val onFps: (Double) -> Unit
) : WebView(context) {
    private var sceneReady = false
    private var disposed = false
    private var rendererGone = false
    private var active = false
    private var paused = false
    private var golden = false
    private var stormy = false
    private var frameRateLimit = 0

    init {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(Color.rgb(23, 111, 121))
        contentDescription = context.getString(R.string.scene_description)
        settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
        }
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                return if (isLocal(uri)) {
                    assets.shouldInterceptRequest(uri) ?: blockedResponse()
                } else {
                    blockedResponse()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !isLocal(request.url)

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) fail("The bundled scene could not be opened.")
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                rendererGone = true
                (view.parent as? ViewGroup)?.removeView(view)
                disposeScene()
                onFailure("The graphics renderer stopped. Please try again.")
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("IslandScene", "${message.message()} (${message.lineNumber()})")
                return true
            }
        }
        addJavascriptInterface(
            object {
                @JavascriptInterface
                fun ready() {
                    post {
                        if (!disposed && !rendererGone) {
                            sceneReady = true
                            sendState()
                            onReady()
                        }
                    }
                }

                @JavascriptInterface
                fun failed(message: String) {
                    post { fail(message.take(240)) }
                }

                @JavascriptInterface
                fun fps(value: Double) {
                    if (!value.isFinite()) return
                    post {
                        if (sceneReady && !disposed && !rendererGone) onFps(value.coerceIn(0.0, 240.0))
                    }
                }
            },
            "IslandAndroid"
        )
        loadUrl(SCENE_URL)
    }

    fun setSceneOptions(isPaused: Boolean, isGolden: Boolean, isStormy: Boolean, requestedFrameRateLimit: Int) {
        if (paused == isPaused && golden == isGolden && stormy == isStormy &&
            frameRateLimit == requestedFrameRateLimit
        ) {
            return
        }
        paused = isPaused
        golden = isGolden
        stormy = isStormy
        frameRateLimit = requestedFrameRateLimit
        sendState()
    }

    fun setSceneActive(isActive: Boolean) {
        if (disposed || rendererGone) return
        active = isActive
        if (active) onResume()
        sendState()
        if (!active) onPause()
    }

    fun recenter() {
        if (sceneReady && !disposed && !rendererGone) {
            evaluateJavascript("window.island?.resetView();", null)
        }
    }

    fun disposeScene() {
        if (disposed) return
        disposed = true
        removeJavascriptInterface("IslandAndroid")
        stopLoading()
        removeAllViews()
        destroy()
    }

    private fun sendState() {
        updateFrameRateRequest()
        if (!sceneReady || disposed || rendererGone) return
        evaluateJavascript(
            "window.island?.setPaused($paused);" +
                "window.island?.setLighting('${if (golden) "golden" else "day"}');" +
                "window.island?.setWeather('${if (stormy) "storm" else "sun"}');" +
                "window.island?.setFrameRateLimit(${if (frameRateLimit == 0) "null" else frameRateLimit});" +
                "window.island?.setActive($active);",
            null
        )
    }

    private fun fail(message: String) {
        if (!disposed) {
            Log.e("IslandScene", message)
            sceneReady = false
            updateFrameRateRequest()
            onFailure(message)
        }
    }

    private fun updateFrameRateRequest() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM && !disposed && !rendererGone) {
            // A view-level preference preserves Android's display, battery and thermal policy.
            requestedFrameRate = if (active && !paused && sceneReady) {
                if (frameRateLimit == 30) 30f else View.REQUESTED_FRAME_RATE_CATEGORY_HIGH
            } else {
                View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT
            }
        }
    }

    private fun isLocal(uri: Uri): Boolean = uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
        uri.port == -1 && uri.path.orEmpty().startsWith("/assets/scene/")

    private fun blockedResponse() = WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Blocked",
        emptyMap(),
        ByteArrayInputStream(ByteArray(0))
    )
}
