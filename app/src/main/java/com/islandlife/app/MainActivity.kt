package com.islandlife.app

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color as ComposeColor

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = ComposeColor(0xFF175D60),
                    onPrimary = ComposeColor.White,
                    secondaryContainer = ComposeColor(0xFFD8E8DF),
                    onSecondaryContainer = ComposeColor(0xFF194F55),
                    surface = ComposeColor(0xFFF8F6EC),
                    onSurface = ComposeColor(0xFF173E42)
                )
            ) {
                IslandScreen()
            }
        }
    }
}
