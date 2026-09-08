plugins {
  id("com.android.application")
}

/**
 * La firma.
 *
 * Igual que la clave que firma las actualizaciones del escritorio, esta vive
 * FUERA del repositorio, que es publico. Se pasa por variables de entorno.
 * Si no hay ninguna, se firma con la clave de depuracion, que es la que Android
 * genera sola: el APK se instala igual, pero no sirve para actualizar sobre uno
 * firmado de verdad.
 */
val rutaClave: String? = System.getenv("ORUKA_APK_KEYSTORE")

android {
  namespace = "com.jojan.oruka"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.jojan.oruka"
    // Android 8. Por debajo el WebView es demasiado viejo para lo que hacemos.
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.16"
  }

  if (rutaClave != null) {
    signingConfigs {
      create("propia") {
        storeFile = file(rutaClave)
        storePassword = System.getenv("ORUKA_APK_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("ORUKA_APK_KEY_ALIAS") ?: "oruka"
        keyPassword = System.getenv("ORUKA_APK_KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig =
        if (rutaClave != null) signingConfigs.getByName("propia")
        else signingConfigs.getByName("debug")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  // Solo esto. Sirve los archivos del paquete por https en vez de por file://,
  // que es lo que convierte la app en un «sitio seguro» y permite usar la
  // camara y guardar la sesion.
  implementation("androidx.webkit:webkit:1.12.1")
}
