# SarbaazSoft POS — Native Android WebView Wrapper

Replaces the static Bubblewrap TWA wrapper with a native Android `WebView` host (`com.sarbaazsoft.shoepos`) so both the top Android status bar and bottom Android navigation bar synchronize live with the active web theme.

## How Dynamic System Bar Sync Works
- **No hardcoded purple (`#9333EA`)**: `colors.xml` and `themes.xml` contain only neutral surface fallbacks (`#FFFFFF` / `#0A0E1A`).
- **Instant JS-to-Native Bridge**: `MainActivity.kt` registers `AndroidNavigationBar` and `Android` `@JavascriptInterface` bridges (`setSystemBarsColor`, `setNavigationBarColor`, `setStatusBarColor`, `syncSystemBarsColor`, `updateThemeColor`) invoked automatically by `index.html` (pre-hydration) and `src/utils/themePalettes.ts` (`syncNativeAndroidSystemBars`) whenever you switch themes or dark/light mode.
- **WCAG Contrast & Android 15 Edge-to-Edge**: `SystemBarThemeManager.kt` tints both window system bars and edge-to-edge `WindowInsetsCompat` spacer bars, disables Android Q contrast scrims (`isNavigationBarContrastEnforced = false`), and switches Back/Home/Recents + status icons between light and dark automatically.
- **Cold-Start Persistence**: Colors are persisted in `SharedPreferences` (`sarbaaz_system_bar_prefs`) and restored synchronously in `onCreate` before first draw.

## Building & Signing Locally
1. Open the `android-wrapper/` folder in **Android Studio** (or use Gradle 8.10.2 with Android SDK 35 & JDK 17).
2. To sign with your existing `signing.keystore` (from `signing-key-info.txt`):
   - Create `android-wrapper/keystore.properties` (never commit this file):
     ```properties
     storeFile=/absolute/path/to/signing.keystore
     storePassword=YOUR_STORE_PASSWORD
     keyAlias=YOUR_KEY_ALIAS
     keyPassword=YOUR_KEY_PASSWORD
     ```
   - Or run from `android-wrapper/`:
     ```bash
     gradle assembleRelease bundleRelease
     ```
   - Outputs:
     - `app/build/outputs/apk/release/app-release.apk`
     - `app/build/outputs/bundle/release/app-release.aab`
