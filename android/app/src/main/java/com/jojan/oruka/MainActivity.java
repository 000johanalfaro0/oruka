package com.jojan.oruka;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

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

  /** Codigo que identifica «esto viene de elegir foto» al volver de la otra app. */
  private static final int PEDIDO_FOTO = 100;

  private WebView web;
  /** El aviso de la pagina web, guardado hasta que vuelva la galeria o la camara. */
  private ValueCallback<Uri[]> callbackFoto;
  /** Donde quedo la foto si se eligio tomarla con la camara, no de la galeria. */
  private Uri fotoDeCamara;

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

      // El WebView tampoco sabe abrir la galeria ni la camara por su cuenta:
      // sin esto, tocar «elegir foto» en la web no hace nada, igual que pasaba
      // con la descarga. Se ofrecen las dos opciones a la vez -galeria o
      // tomar una nueva- y se le devuelve a la web lo que la persona elija.
      @Override
      public boolean onShowFileChooser(WebView vista, ValueCallback<Uri[]> callback,
          FileChooserParams parametros) {
        if (callbackFoto != null) {
          callbackFoto.onReceiveValue(null);
        }
        callbackFoto = callback;

        Intent galeria = new Intent(Intent.ACTION_GET_CONTENT);
        galeria.addCategory(Intent.CATEGORY_OPENABLE);
        galeria.setType("image/*");

        Intent elegir = Intent.createChooser(galeria, "Elegir imagen");

        Intent camara = crearIntentCamara();
        if (camara != null) {
          elegir.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] {camara});
        }

        try {
          startActivityForResult(elegir, PEDIDO_FOTO);
        } catch (Exception e) {
          callbackFoto = null;
          return false;
        }
        return true;
      }
    });

    // El WebView no sabe bajar archivos: sin esto, tocar el enlace del APK
    // nuevo intenta abrirlo como si fuera una pagina y no pasa nada, sin
    // avisar del fallo. Se lo pasa al navegador del sistema, que si sabe.
    web.setDownloadListener(new DownloadListener() {
      @Override
      public void onDownloadStart(String url, String userAgent, String contentDisposition,
          String mimetype, long contentLength) {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
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

  /**
   * Prepara el intent de camara con un archivo de verdad para guardar la foto.
   *
   * Sin decirle donde guardarla, la camara solo devuelve una miniatura -no
   * sirve para subir una foto legible de un cuaderno. `null` si algo falla al
   * crear el archivo: la galeria se ofrece igual, solo se pierde la opcion
   * de tomar una nueva.
   */
  private Intent crearIntentCamara() {
    Intent camara = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
    if (camara.resolveActivity(getPackageManager()) == null) {
      return null;
    }
    try {
      String nombre = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
      File carpeta = new File(getCacheDir(), "fotos");
      if (!carpeta.exists() && !carpeta.mkdirs()) {
        return null;
      }
      File archivo = File.createTempFile("foto_" + nombre, ".jpg", carpeta);
      fotoDeCamara = FileProvider.getUriForFile(this, "com.jojan.oruka.fileprovider", archivo);
      camara.putExtra(MediaStore.EXTRA_OUTPUT, fotoDeCamara);
      camara.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
      return camara;
    } catch (IOException e) {
      return null;
    }
  }

  @Override
  protected void onActivityResult(int codigo, int resultado, Intent datos) {
    super.onActivityResult(codigo, resultado, datos);
    if (codigo != PEDIDO_FOTO || callbackFoto == null) {
      return;
    }

    Uri[] elegido = null;
    if (resultado == RESULT_OK) {
      if (datos != null && datos.getData() != null) {
        // Vino de la galeria.
        elegido = new Uri[] {datos.getData()};
      } else if (fotoDeCamara != null) {
        // Vino de la camara: no trae datos, la foto ya quedo en el archivo.
        elegido = new Uri[] {fotoDeCamara};
      }
    }

    callbackFoto.onReceiveValue(elegido);
    callbackFoto = null;
    fotoDeCamara = null;
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
