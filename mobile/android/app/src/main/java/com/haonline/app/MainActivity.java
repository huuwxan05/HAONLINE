package com.haonline.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQUEST_FILE = 1001;
    private static final int REQUEST_PERMISSIONS = 1002;
    private static final String PREFS = "haonline";
    private static final String PREF_BASE_URL = "base_url";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;
    private String[] pendingPermissionResources;
    private SharedPreferences preferences;
    private String baseUrl;
    private String baseScheme;
    private String baseHost;
    private int basePort;
    private boolean showingConnectionError;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(6, 8, 20));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(6, 8, 20));
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String savedBaseUrl = normalizeBaseUrl(preferences.getString(PREF_BASE_URL, BuildConfig.HAONLINE_BASE_URL));
        if (validateBaseUrl(savedBaseUrl) != null) savedBaseUrl = normalizeBaseUrl(BuildConfig.HAONLINE_BASE_URL);
        applyBaseUrl(savedBaseUrl);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " HAONLINEAndroid/1.0");
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            download(url, contentDisposition, mimeType)
        );

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            String target = getIntent().getStringExtra("url");
            webView.loadUrl(isTrusted(target) ? target : baseUrl);
        }
    }

    private String normalizeBaseUrl(String value) {
        String url = value == null ? "" : value.trim();
        if (url.isEmpty()) return "";
        if (!url.contains("://")) url = "http://" + url;
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    private String validateBaseUrl(String value) {
        if (value == null || value.isEmpty()) return "Địa chỉ máy chủ không được để trống.";
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || (!"http".equals(scheme) && !"https".equals(scheme))) {
            return "Địa chỉ phải bắt đầu bằng http:// hoặc https://.";
        }
        if ("http".equals(scheme) && !isLocalHost(host)) {
            return "HTTP chỉ dùng cho localhost. Hãy dùng HTTPS cho máy chủ khác.";
        }
        return null;
    }

    private boolean isLocalHost(String host) {
        return "localhost".equalsIgnoreCase(host)
            || "127.0.0.1".equals(host)
            || "::1".equals(host)
            || "[::1]".equals(host)
            || "10.0.2.2".equals(host);
    }

    private void applyBaseUrl(String url) {
        Uri uri = Uri.parse(url);
        baseUrl = url;
        baseScheme = uri.getScheme();
        baseHost = uri.getHost();
        basePort = uri.getPort();
    }

    private int effectivePort(String scheme, int port) {
        if (port != -1) return port;
        return "https".equals(scheme) ? 443 : 80;
    }

    private void showServerDialog() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(baseUrl);
        input.setSelectAllOnFocus(true);

        FrameLayout wrap = new FrameLayout(this);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        wrap.setPadding(pad, pad / 2, pad, 0);
        wrap.addView(input, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Máy chủ HAONLINE")
            .setMessage("Nhập địa chỉ web HAONLINE. Mặc định: " + BuildConfig.HAONLINE_BASE_URL)
            .setView(wrap)
            .setPositiveButton("Lưu", null)
            .setNeutralButton("Mặc định", (d, which) -> {
                preferences.edit().remove(PREF_BASE_URL).apply();
                applyBaseUrl(normalizeBaseUrl(BuildConfig.HAONLINE_BASE_URL));
                webView.loadUrl(baseUrl);
            })
            .setNegativeButton("Hủy", null)
            .create();

        dialog.setOnShowListener((d) -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener((v) -> {
            String next = normalizeBaseUrl(input.getText().toString());
            String error = validateBaseUrl(next);
            if (error != null) {
                Toast.makeText(this, error, Toast.LENGTH_LONG).show();
                return;
            }
            preferences.edit().putString(PREF_BASE_URL, next).apply();
            applyBaseUrl(next);
            dialog.dismiss();
            webView.loadUrl(baseUrl);
        }));
        dialog.show();
    }

    private void showConnectionError() {
        if (showingConnectionError || isFinishing()) return;
        showingConnectionError = true;
        new AlertDialog.Builder(this)
            .setTitle("Không kết nối được máy chủ")
            .setMessage("Không mở được " + baseUrl + ". Hãy chắc chắn máy chủ HAONLINE đang chạy.")
            .setPositiveButton("Thử lại", (d, which) -> {
                showingConnectionError = false;
                webView.loadUrl(baseUrl);
            })
            .setNeutralButton("Đổi địa chỉ", (d, which) -> {
                showingConnectionError = false;
                showServerDialog();
            })
            .setNegativeButton("Đóng", (d, which) -> showingConnectionError = false)
            .setOnCancelListener((d) -> showingConnectionError = false)
            .show();
    }

    private boolean isServerSettings(Uri uri) {
        return uri != null && isTrusted(uri) && "/__server".equals(uri.getPath());
    }

    private boolean isTrusted(Uri uri) {
        if (uri == null || baseHost == null) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return false;
        if (!"https".equals(scheme) && !"http".equals(scheme)) return false;
        if (!scheme.equals(baseScheme) || !baseHost.equalsIgnoreCase(host)) return false;
        return effectivePort(scheme, uri.getPort()) == effectivePort(baseScheme, basePort);
    }

    private boolean isTrusted(String url) {
        if (url == null) return false;
        if (url.startsWith("about:") || url.startsWith("blob:") || url.startsWith("data:")) return true;
        return isTrusted(Uri.parse(url));
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            Toast.makeText(this, R.string.app_name, Toast.LENGTH_SHORT).show();
        }
    }

    private void download(String url, String contentDisposition, String mimeType) {
        if (url == null || url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "Không thể tải tệp này trực tiếp", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            manager.enqueue(request);
            Toast.makeText(this, "Đang tải xuống", Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
            Toast.makeText(this, "Không thể tải tệp xuống", Toast.LENGTH_SHORT).show();
        }
    }

    private void grantMediaPermission(PermissionRequest request, String[] resources) {
        if (!isTrusted(request.getOrigin())) {
            request.deny();
            return;
        }
        request.grant(resources);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_PERMISSIONS || pendingPermissionRequest == null) return;
        boolean granted = grantResults.length > 0;
        for (int result : grantResults) granted = granted && result == PackageManager.PERMISSION_GRANTED;
        if (granted) grantMediaPermission(pendingPermissionRequest, pendingPermissionResources);
        else pendingPermissionRequest.deny();
        pendingPermissionRequest = null;
        pendingPermissionResources = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isServerSettings(uri)) {
                showServerDialog();
                return true;
            }
            if (isTrusted(uri)) return false;
            openExternal(uri);
            return true;
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isServerSettings(uri)) {
                showServerDialog();
                return true;
            }
            if (isTrusted(url)) return false;
            try {
                openExternal(uri);
            } catch (Exception ignored) {
                return true;
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
            if (request.isForMainFrame()) showConnectionError();
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
            handler.cancel();
            Toast.makeText(MainActivity.this, "Kết nối không an toàn đã bị chặn", Toast.LENGTH_LONG).show();
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(Intent.createChooser(intent, "Chọn tệp"), REQUEST_FILE);
                return true;
            } catch (Exception err) {
                filePathCallback = null;
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            List<String> missing = new ArrayList<>();
            List<String> wanted = new ArrayList<>();
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                    wanted.add(resource);
                    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        missing.add(Manifest.permission.CAMERA);
                    }
                } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                    wanted.add(resource);
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        missing.add(Manifest.permission.RECORD_AUDIO);
                    }
                }
            }
            if (!wanted.isEmpty() && !missing.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingPermissionRequest = request;
                pendingPermissionResources = wanted.toArray(new String[0]);
                requestPermissions(missing.toArray(new String[0]), REQUEST_PERMISSIONS);
                return;
            }
            grantMediaPermission(request, wanted.isEmpty() ? new String[0] : wanted.toArray(new String[0]));
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            boolean allowed = isTrusted(Uri.parse(origin))
                && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            callback.invoke(origin, allowed, false);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                    if (isTrusted(request.getUrl())) MainActivity.this.webView.loadUrl(request.getUrl().toString());
                    else openExternal(request.getUrl());
                    ((ViewGroup) popupView.getParent()).removeView(popupView);
                    popupView.destroy();
                    return true;
                }
            });
            popup.setLayoutParams(new ViewGroup.LayoutParams(1, 1));
            ((ViewGroup) webView.getParent()).addView(popup);
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                .setMessage(message)
                .setPositiveButton("OK", (dialog, which) -> result.confirm())
                .setOnCancelListener(dialog -> result.cancel())
                .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                .setMessage(message)
                .setPositiveButton("OK", (dialog, which) -> result.confirm())
                .setNegativeButton("Hủy", (dialog, which) -> result.cancel())
                .setOnCancelListener(dialog -> result.cancel())
                .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            EditText input = new EditText(MainActivity.this);
            input.setText(defaultValue == null ? "" : defaultValue);
            new AlertDialog.Builder(MainActivity.this)
                .setMessage(message)
                .setView(input)
                .setPositiveButton("OK", (dialog, which) -> result.confirm(input.getText().toString()))
                .setNegativeButton("Hủy", (dialog, which) -> result.cancel())
                .setOnCancelListener(dialog -> result.cancel())
                .show();
            return true;
        }
    }
}
