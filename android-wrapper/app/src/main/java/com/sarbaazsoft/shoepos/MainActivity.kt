package com.sarbaazsoft.shoepos

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.Keep
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import kotlin.math.max

class MainActivity : AppCompatActivity() {

    private lateinit var rootLayout: LinearLayout
    private lateinit var statusBarSpacer: View
    private lateinit var webContainer: FrameLayout
    private lateinit var imeSpacer: View
    private lateinit var navigationBarSpacer: View
    private lateinit var webView: WebView
    private lateinit var offlineOverlay: LinearLayout
    private lateinit var systemBarThemeManager: SystemBarThemeManager

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = fileUploadCallback
        fileUploadCallback = null
        if (callback == null) return@registerForActivityResult

        val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
            val data = result.data
            val clipData = data?.clipData
            when {
                clipData != null && clipData.itemCount > 0 -> {
                    Array(clipData.itemCount) { idx -> clipData.getItemAt(idx).uri }
                }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } else {
            null
        }
        callback.onReceiveValue(uris)
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val webReq = pendingWebPermissionRequest
        pendingWebPermissionRequest = null
        if (webReq != null) {
            val allGranted = grants.values.all { it }
            if (allGranted) {
                webReq.grant(webReq.resources)
            } else {
                webReq.deny()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        buildLayout()

        systemBarThemeManager = SystemBarThemeManager(
            activity = this,
            statusBarSpacer = statusBarSpacer,
            navigationBarSpacer = navigationBarSpacer,
        )
        // Restore persisted theme colors synchronously before first draw so reopen never flashes purple
        systemBarThemeManager.restoreSavedOrDefault()

        configureWindowInsets()
        configureWebView()
        configureBackNavigation()
        requestNotificationPermissionIfNeeded()

        val initialUrl = intent?.data?.toString()?.takeIf { isAllowedInAppUrl(it) }
            ?: BuildConfig.APP_BASE_URL
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(initialUrl)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val deepLink = intent.data?.toString()
        if (!deepLink.isNullOrBlank() && isAllowedInAppUrl(deepLink)) {
            webView.loadUrl(deepLink)
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        systemBarThemeManager.restoreSavedOrDefault()
        syncFromActiveDom()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        syncFromActiveDom()
    }

    override fun onDestroy() {
        fileUploadCallback?.onReceiveValue(null)
        fileUploadCallback = null
        webView.removeJavascriptInterface("AndroidNavigationBar")
        webView.removeJavascriptInterface("Android")
        webView.destroy()
        super.onDestroy()
    }

    private fun buildLayout() {
        rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        statusBarSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0)
        }

        webContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        offlineOverlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(64, 64, 64, 64)
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )

            val title = TextView(context).apply {
                text = getString(R.string.offline_title)
                textSize = 20f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            }
            val subtitle = TextView(context).apply {
                text = getString(R.string.offline_subtitle)
                textSize = 14f
                setTextColor(Color.parseColor("#CBD5E1"))
                gravity = Gravity.CENTER
                setPadding(0, 20, 0, 40)
            }
            val retryButton = Button(context).apply {
                text = getString(R.string.retry_label)
                setOnClickListener {
                    visibility = View.GONE
                    webView.reload()
                }
            }
            addView(title)
            addView(subtitle)
            addView(retryButton)
        }

        imeSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0)
            setBackgroundColor(Color.TRANSPARENT)
        }

        navigationBarSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0)
        }

        webContainer.addView(webView)
        webContainer.addView(offlineOverlay)

        rootLayout.addView(statusBarSpacer)
        rootLayout.addView(webContainer)
        rootLayout.addView(imeSpacer)
        rootLayout.addView(navigationBarSpacer)

        setContentView(rootLayout)
    }

    private fun configureWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { _, insets ->
            val topInsets = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val navInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())

            statusBarSpacer.updateLayoutParams { height = topInsets.top }
            navigationBarSpacer.updateLayoutParams { height = navInsets.bottom }
            imeSpacer.updateLayoutParams { height = max(0, imeInsets.bottom - navInsets.bottom) }

            val leftInset = max(topInsets.left, navInsets.left)
            val rightInset = max(topInsets.right, navInsets.right)
            webContainer.setPadding(leftInset, 0, rightInset, 0)

            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(rootLayout)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            useWideViewPort = true
            loadWithOverviewMode = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            allowFileAccess = false
            allowContentAccess = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
        }

        val bridge = SystemBarBridge(systemBarThemeManager)
        webView.addJavascriptInterface(bridge, "AndroidNavigationBar")
        webView.addJavascriptInterface(bridge, "Android")

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    val request = DownloadManager.Request(Uri.parse(url)).apply {
                        setMimeType(mimeType)
                        val cookies = CookieManager.getInstance().getCookie(url)
                        if (!cookies.isNullOrBlank()) {
                            addRequestHeader("cookie", cookies)
                        }
                        addRequestHeader("User-Agent", userAgent)
                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                    }
                    val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                    dm.enqueue(request)
                }
            } catch (_: Exception) {
                openExternalUri(Uri.parse(url))
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val url = uri.toString()
                if (url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("about:")) {
                    return false
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    if (isAllowedInAppUrl(url)) {
                        return false
                    }
                    openExternalUri(uri)
                    return true
                }
                openExternalUri(uri)
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                offlineOverlay.visibility = View.GONE
                installThemeObserverAndSync(view)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    offlineOverlay.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                val chooserIntent = try {
                    fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                } catch (_: Exception) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    return false
                }
                return try {
                    fileChooserLauncher.launch(chooserIntent)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val requiredAndroidPermissions = mutableListOf<String>()
                for (res in request.resources) {
                    if (res == PermissionRequest.RESOURCE_VIDEO_CAPTURE &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
                        != PackageManager.PERMISSION_GRANTED
                    ) {
                        requiredAndroidPermissions.add(Manifest.permission.CAMERA)
                    }
                }
                if (requiredAndroidPermissions.isEmpty()) {
                    request.grant(request.resources)
                } else {
                    pendingWebPermissionRequest = request
                    permissionLauncher.launch(requiredAndroidPermissions.toTypedArray())
                }
            }
        }
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        )
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            }
        }
    }

    private fun syncFromActiveDom() {
        if (!::webView.isInitialized) return
        installThemeObserverAndSync(webView)
    }

    private fun installThemeObserverAndSync(targetWebView: WebView?) {
        targetWebView?.evaluateJavascript(
            """
            (function() {
              try {
                function pushActiveBars() {
                  var root = document.documentElement;
                  var metaTheme = document.querySelector('meta[name="theme-color"]');
                  var attrHex = root ? root.getAttribute('data-android-nav-bar-color') : null;
                  var metaHex = metaTheme ? metaTheme.getAttribute('content') : null;
                  var hex = metaHex || attrHex;
                  if (!hex || !/^#([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(hex.trim())) return;
                  var contrastAttr = root ? root.getAttribute('data-nav-bar-contrast') : null;
                  if (attrHex && attrHex.toUpperCase() === hex.trim().toUpperCase() && contrastAttr) {
                    var isLightBg = contrastAttr === 'dark';
                    if (window.AndroidNavigationBar && typeof window.AndroidNavigationBar.setSystemBarsColor === 'function') {
                      window.AndroidNavigationBar.setSystemBarsColor(hex, hex, isLightBg);
                      return;
                    }
                  }
                  if (window.AndroidNavigationBar && typeof window.AndroidNavigationBar.syncSystemBarsColor === 'function') {
                    window.AndroidNavigationBar.syncSystemBarsColor(hex);
                  }
                }
                pushActiveBars();
                if (!window.__sarbaazSystemBarObserverInstalled) {
                  window.__sarbaazSystemBarObserverInstalled = true;
                  var observer = new MutationObserver(function() { pushActiveBars(); });
                  if (document.documentElement) {
                    observer.observe(document.documentElement, {
                      attributes: true,
                      attributeFilter: ['data-android-nav-bar-color', 'data-nav-bar-contrast', 'data-accent-theme', 'data-theme', 'class']
                    });
                  }
                  var metaEl = document.querySelector('meta[name="theme-color"]');
                  if (metaEl) {
                    observer.observe(metaEl, { attributes: true, attributeFilter: ['content'] });
                  }
                  window.addEventListener('pos:system-bars-changed', pushActiveBars);
                  window.addEventListener('pos:theme-changed', pushActiveBars);
                }
              } catch (e) {}
            })();
            """.trimIndent(),
            null
        )
    }

    private fun isAllowedInAppUrl(url: String): Boolean {
        val host = Uri.parse(url).host?.lowercase() ?: return false
        return host == "sarbaazsoft.cloud.run" ||
            host.endsWith(".sarbaazsoft.cloud.run") ||
            host.endsWith(".run.app") ||
            host == "accounts.google.com" ||
            host.endsWith(".firebaseapp.com") ||
            host == "localhost"
    }

    private fun openExternalUri(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            // No handler installed
        }
    }

    @Suppress("unused")
    fun printCurrentPage(jobName: String = getString(R.string.app_name)) {
        val printManager = getSystemService(Context.PRINT_SERVICE) as? PrintManager ?: return
        val printAdapter = webView.createPrintDocumentAdapter(jobName)
        printManager.print(jobName, printAdapter, PrintAttributes.Builder().build())
    }
}

@Keep
class SystemBarBridge(private val manager: SystemBarThemeManager) {

    @Keep
    @JavascriptInterface
    fun setSystemBarsColor(
        statusColorHex: String?,
        navigationColorHex: String?,
        isLightNavBackground: Boolean,
    ) {
        manager.applySystemBars(statusColorHex, navigationColorHex, isLightNavBackground, persist = true)
    }

    @Keep
    @JavascriptInterface
    fun syncSystemBarsColor(colorHex: String?) {
        manager.applySystemBars(colorHex, colorHex, lightNavIconsOverride = null, persist = true)
    }

    @Keep
    @JavascriptInterface
    fun setNavigationBarColor(
        navigationColorHex: String?,
        isLightNavBackground: Boolean,
    ) {
        manager.applyNavigationBarOnly(navigationColorHex, isLightNavBackground)
    }

    @Keep
    @JavascriptInterface
    fun setStatusBarColor(
        statusColorHex: String?,
        isLightStatusBackground: Boolean,
    ) {
        manager.applyStatusBarOnly(statusColorHex, isLightStatusBackground)
    }

    @Keep
    @JavascriptInterface
    fun updateThemeColor(
        colorHex: String?,
        isLightBackground: Boolean,
    ) {
        manager.applySystemBars(colorHex, colorHex, isLightBackground, persist = true)
    }

    @Keep
    @JavascriptInterface
    fun getSavedSystemBarColor(): String {
        return manager.getSavedHex()
    }
}
