package com.sarbaazsoft.shoepos

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.WindowManager
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowInsetsControllerCompat

class SystemBarThemeManager(
    private val activity: Activity,
    private val statusBarSpacer: View,
    private val navigationBarSpacer: View,
) {
    private val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Volatile
    private var currentStatusHex: String = ""

    @Volatile
    private var currentNavHex: String = ""

    fun restoreSavedOrDefault() {
        val savedStatus = prefs.getString(KEY_STATUS_HEX, null)
        val savedNav = prefs.getString(KEY_NAV_HEX, null)

        if (!savedStatus.isNullOrBlank() || !savedNav.isNullOrBlank()) {
            val statusHex = savedStatus ?: savedNav!!
            val navHex = savedNav ?: savedStatus!!
            val hasLightPref = prefs.contains(KEY_LIGHT_NAV_ICONS)
            val lightOverride = if (hasLightPref) prefs.getBoolean(KEY_LIGHT_NAV_ICONS, false) else null
            applySystemBars(statusHex, navHex, lightOverride, persist = false)
            return
        }

        val isNight = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val fallbackHex = if (isNight) "#0A0E1A" else "#FFFFFF"
        applySystemBars(fallbackHex, fallbackHex, lightNavIconsOverride = !isNight, persist = false)
    }

    fun getSavedHex(): String {
        return currentNavHex.ifBlank {
            prefs.getString(KEY_NAV_HEX, "") ?: ""
        }
    }

    fun applySystemBars(
        statusColorHex: String?,
        navColorHex: String?,
        lightNavIconsOverride: Boolean? = null,
        persist: Boolean = true,
    ) {
        val parsedStatus = parseOpaqueColor(statusColorHex) ?: parseOpaqueColor(navColorHex) ?: return
        val parsedNav = parseOpaqueColor(navColorHex) ?: parsedStatus

        val normalizedStatusHex = formatHex(parsedStatus)
        val normalizedNavHex = formatHex(parsedNav)
        val isLightStatusIcons = shouldUseDarkIcons(parsedStatus)
        val isLightNavIcons = lightNavIconsOverride ?: shouldUseDarkIcons(parsedNav)

        currentStatusHex = normalizedStatusHex
        currentNavHex = normalizedNavHex

        if (persist) {
            prefs.edit()
                .putString(KEY_STATUS_HEX, normalizedStatusHex)
                .putString(KEY_NAV_HEX, normalizedNavHex)
                .putBoolean(KEY_LIGHT_NAV_ICONS, isLightNavIcons)
                .apply()
        }

        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread

            statusBarSpacer.setBackgroundColor(parsedStatus)
            navigationBarSpacer.setBackgroundColor(parsedNav)

            val window = activity.window
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            @Suppress("DEPRECATION")
            run {
                window.statusBarColor = parsedStatus
                window.navigationBarColor = parsedNav
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.isStatusBarContrastEnforced = false
                window.isNavigationBarContrastEnforced = false
            }

            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = isLightStatusIcons
            controller.isAppearanceLightNavigationBars = isLightNavIcons
        }
    }

    fun applyNavigationBarOnly(navColorHex: String?, lightNavIconsOverride: Boolean? = null) {
        val statusHex = currentStatusHex.ifBlank {
            prefs.getString(KEY_STATUS_HEX, null) ?: navColorHex
        }
        applySystemBars(statusHex, navColorHex, lightNavIconsOverride, persist = true)
    }

    fun applyStatusBarOnly(statusColorHex: String?, lightStatusIconsOverride: Boolean? = null) {
        val navHex = currentNavHex.ifBlank {
            prefs.getString(KEY_NAV_HEX, null) ?: statusColorHex
        }
        val parsedStatus = parseOpaqueColor(statusColorHex) ?: return
        val parsedNav = parseOpaqueColor(navHex) ?: parsedStatus
        val normalizedStatusHex = formatHex(parsedStatus)
        val normalizedNavHex = formatHex(parsedNav)
        val isLightStatusIcons = lightStatusIconsOverride ?: shouldUseDarkIcons(parsedStatus)
        val isLightNavIcons = shouldUseDarkIcons(parsedNav)

        currentStatusHex = normalizedStatusHex
        currentNavHex = normalizedNavHex

        prefs.edit()
            .putString(KEY_STATUS_HEX, normalizedStatusHex)
            .putString(KEY_NAV_HEX, normalizedNavHex)
            .putBoolean(KEY_LIGHT_NAV_ICONS, isLightNavIcons)
            .apply()

        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread

            statusBarSpacer.setBackgroundColor(parsedStatus)
            navigationBarSpacer.setBackgroundColor(parsedNav)

            val window = activity.window
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            @Suppress("DEPRECATION")
            run {
                window.statusBarColor = parsedStatus
                window.navigationBarColor = parsedNav
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.isStatusBarContrastEnforced = false
                window.isNavigationBarContrastEnforced = false
            }

            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = isLightStatusIcons
            controller.isAppearanceLightNavigationBars = isLightNavIcons
        }
    }

    private fun parseOpaqueColor(raw: String?): Int? {
        if (raw.isNullOrBlank()) return null
        val trimmed = raw.trim()
        val hex = if (trimmed.startsWith("#")) trimmed else "#$trimmed"
        val normalized = when (hex.length) {
            4 -> {
                val r = hex[1]
                val g = hex[2]
                val b = hex[3]
                "#$r$r$g$g$b$b"
            }
            7, 9 -> hex
            else -> return null
        }
        return try {
            val parsed = Color.parseColor(normalized)
            Color.rgb(Color.red(parsed), Color.green(parsed), Color.blue(parsed))
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun formatHex(colorInt: Int): String {
        return String.format("#%06X", 0xFFFFFF and colorInt)
    }

    /**
     * Matches resolveSystemBarContrast() in src/utils/themePalettes.ts:
     * picks white icons when white WCAG contrast >= 3.0 or >= dark slate (#0F172A) contrast,
     * otherwise switches system bar icons to dark (#0F172A) so Back/Home/Recents remain legible.
     */
    private fun shouldUseDarkIcons(bgColorInt: Int): Boolean {
        val whiteContrast = ColorUtils.calculateContrast(Color.WHITE, bgColorInt)
        val darkSlate = Color.rgb(15, 23, 42)
        val darkContrast = ColorUtils.calculateContrast(darkSlate, bgColorInt)
        val useLightIcons = whiteContrast >= 3.0 || whiteContrast >= darkContrast
        return !useLightIcons
    }

    companion object {
        private const val PREFS_NAME = "sarbaaz_system_bar_prefs"
        private const val KEY_STATUS_HEX = "status_bar_hex"
        private const val KEY_NAV_HEX = "nav_bar_hex"
        private const val KEY_LIGHT_NAV_ICONS = "light_nav_icons"
    }
}
