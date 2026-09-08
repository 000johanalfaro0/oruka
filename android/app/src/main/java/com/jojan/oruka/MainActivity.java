package com.jojan.oruka;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * La app entera.
 *
 * Dentro no hay pantallas de Android: hay la misma web que se abre desde el
 * ordenador, empaquetada en el APK. Asi hay una sola interfaz que mantener.
 *
 * El detalle que importa es COMO se cargan esos archivos. Un WebView que abre
 * `file://` no es un sitio seguro para el navegador, y sin eso no hay camara
 * (no se podria escanear el QR) ni almacen donde guardar la sesion. Por eso los
 * archivos del paquete se sirven por https a traves del cargador de androidx.
 */
public class MainActivity extends Activity {

  /** Los archivos del paquete, servidos como si fueran un sitio web. */
  private static final String INICIO =
      "https://appassets.androidplatform.net/assets/web/index.html";

  private WebView web;

  @Override
  protected void onCreate(Bundle estado) {
    super.onCreate(estado);

    final WebViewAssetLoader cargador = new WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
        .build();

    web = new WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    // Sin esto Android exige un toque antes de encender la camara, y el
    // escaneo se quedaria en negro sin explicar por que.
    web.getSettings().setMediaPlaybackRequiresUserGesture(false);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView vista, WebResourceRequest peticion) {
        return cargador.shouldInterceptRequest(peticion.getUrl());
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest peticion) {
        // Lo unico que esta web pide es la camara, y solo al pulsar «Escanear».
        runOnUiThread(new Runnable() {
          @Override
          public void run() {
            peticion.grant(peticion.getResources());
          }
        });
      }
    });

    setContentView(web);
    pedirCamara();
    web.loadUrl(INICIO);
  }

  /**
   * Pide la camara al sistema.
   *
   * Se pide al abrir y no al escanear porque el WebView solo puede conceder lo
   * que la app ya tiene: si el permiso de Android falta, la web pediria camara
   * y se le negaria sin que nadie viera un dialogo.
   */
  private void pedirCamara() {
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {Manifest.permission.CAMERA}, 1);
    }
  }

  /** El boton de atras navega dentro de la web antes de cerrar la app. */
  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) {
      web.goBack();
    } else {
      super.onBackPressed();
    }
  }
}
