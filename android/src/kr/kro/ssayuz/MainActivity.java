package kr.kro.ssayuz;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * ssayuz 앱: ssayuz.kro.kr 을 앱 화면으로 보여 줘요.
 * 사이트를 고치면 앱도 바로 바뀌어서, 기능 업데이트 때마다 스토어에 다시 올릴 필요가 없어요.
 */
public class MainActivity extends Activity {
    static final String HOME = "https://ssayuz.kro.kr/";
    static final String[] OUR_HOSTS = { "ssayuz.kro.kr", "ssayuz.github.io" };

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        final FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // 안드로이드 15부터 화면이 상태바 밑까지 그려지므로, 상태바/내비게이션바 만큼 여백 주기
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets;
            }
        });
        lightBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // 로그인 유지
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " SsayuzApp/1.0");
        web.addJavascriptInterface(new Bridge(), "SsayuzApp");
        web.setWebViewClient(new Client());

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(startUrl(getIntent()));
        }
    }

    // 다크 모드가 아니면 상태바 아이콘을 어둡게
    private void lightBars() {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(night ? 0 : mask, mask);
            }
        } else if (Build.VERSION.SDK_INT >= 23 && !night) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && isOurs(data)) return data.toString();
        return HOME;
    }

    static boolean isOurs(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())) return false;
        String host = uri.getHost();
        for (String h : OUR_HOSTS) if (h.equalsIgnoreCase(host)) return true;
        return false;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && isOurs(data)) web.loadUrl(data.toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // 열 수 있는 앱이 없음
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri uri = req.getUrl();
            if (isOurs(uri)) return false; // ssayuz 안에서 이동
            openOutside(uri); // 바깥 링크는 브라우저로
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) showOffline();
        }
    }

    private void showOffline() {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        String bg = night ? "#131217" : "#FBF5EA";
        String fg = night ? "#F3EDE2" : "#1A1820";
        String html = "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;"
                + "font-family:sans-serif;background:" + bg + ";color:" + fg + ";text-align:center;padding:24px;box-sizing:border-box}"
                + "b{font-size:28px;background:#C9F23D;color:#1A1820;padding:6px 12px;border:2px solid #1A1820;border-radius:10px}"
                + "p{opacity:.75;line-height:1.6}a{display:inline-block;margin-top:12px;padding:12px 22px;border-radius:12px;"
                + "background:" + fg + ";color:" + bg + ";text-decoration:none;font-weight:bold}</style></head><body>"
                + "<b>ssayuz</b><p>인터넷에 연결되지 않았어요.<br>연결을 확인하고 다시 시도해 주세요.</p>"
                + "<a href='" + HOME + "'>다시 시도</a></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /** 사이트(JavaScript)에서 부르는 앱 기능: window.SsayuzApp.share(url) */
    private class Bridge {
        @JavascriptInterface
        public void share(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, url);
                    startActivity(Intent.createChooser(send, "ssayuz 링크 공유"));
                }
            });
        }

        @JavascriptInterface
        public String version() {
            return "1.0";
        }
    }
}
