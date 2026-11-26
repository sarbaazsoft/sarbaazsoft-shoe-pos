# Preserve JavascriptInterface methods so R8/ProGuard never strips native WebView bridge entrypoints
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes *Annotation*
-keep class com.sarbaazsoft.shoepos.SystemBarBridge { *; }
