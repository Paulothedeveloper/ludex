package gg.ludex.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import java.io.File
import java.io.FileOutputStream

class MainActivity : TauriActivity() {
  companion object {
    init {
      System.loadLibrary("app_lib")
    }
    @JvmStatic external fun ludexInitNdkContext(activity: android.app.Activity)

    // v0.8.14: extrai cores libretro de assets/cores/*.so para filesystem privado
    // do app. Android nao permite dlopen direto de assets; precisa de path real.
    // Cores ficam em /data/data/gg.ludex.app/files/Ludex/cores/.
    @JvmStatic
    fun extractCoresAssets(activity: android.app.Activity) {
      try {
        val coresDir = File(activity.filesDir, "Ludex/cores")
        coresDir.mkdirs()
        val assetMgr = activity.assets
        val files = assetMgr.list("cores") ?: return
        for (name in files) {
          if (!name.endsWith(".so")) continue
          val out = File(coresDir, name)
          val inputStream = assetMgr.open("cores/$name")
          // Re-extrai se tamanho mudou (update do app)
          val needsExtract = !out.exists() || out.length() == 0L ||
            out.length() != inputStream.available().toLong()
          inputStream.close()
          if (!needsExtract) continue
          assetMgr.open("cores/$name").use { input ->
            FileOutputStream(out).use { output ->
              input.copyTo(output)
            }
          }
        }
      } catch (_: Throwable) {}
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    try { ludexInitNdkContext(this) } catch (_: Throwable) {}
    try { extractCoresAssets(this) } catch (_: Throwable) {}
  }
}
