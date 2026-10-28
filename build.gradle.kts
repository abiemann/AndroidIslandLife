plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
    id("com.diffplug.spotless") version "8.10.4"
}

spotless {
    kotlin {
        target("app/src/**/*.kt")
        ktlint("1.8.0").setEditorConfigPath(rootProject.file(".editorconfig").path)
    }
    kotlinGradle {
        target("*.gradle.kts", "app/*.gradle.kts")
        ktlint("1.8.0").setEditorConfigPath(rootProject.file(".editorconfig").path)
    }
}
