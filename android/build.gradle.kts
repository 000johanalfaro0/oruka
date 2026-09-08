// La app de Android no es una app aparte: es la misma web del telefono metida
// en un paquete instalable. Todo lo que se ve dentro sale de `dist-mobile`.
plugins {
  id("com.android.application") version "8.7.3" apply false
}
