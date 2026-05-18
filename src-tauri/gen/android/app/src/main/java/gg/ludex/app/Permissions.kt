package gg.ludex.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

class Permissions {
    companion object {
        @JvmStatic
        fun hasAllFilesAccess(): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Environment.isExternalStorageManager()
            } else {
                true
            }
        }

        @JvmStatic
        fun openAllFilesAccessSettings(activity: Activity) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                    intent.data = Uri.parse("package:" + activity.packageName)
                    activity.startActivity(intent)
                    return
                }
            } catch (_: Exception) {}
            // fallback: tela de detalhes do app
            try {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                intent.data = Uri.parse("package:" + activity.packageName)
                activity.startActivity(intent)
            } catch (_: Exception) {}
        }

        /**
         * Abre o Files Manager / DocumentsUI no path informado.
         * Falha silenciosamente se nao houver app que lide com a Intent.
         */
        @JvmStatic
        fun openFolder(activity: Activity, absPath: String) {
            val file = File(absPath)
            try { file.mkdirs() } catch (_: Throwable) {}
            // Tenta DocumentsUI primeiro (Samsung Files / Files by Google)
            try {
                val uri = Uri.parse("content://com.android.externalstorage.documents/document/primary:" +
                    absPath.removePrefix("/storage/emulated/0/"))
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "vnd.android.document/directory")
                    flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                }
                activity.startActivity(intent)
                return
            } catch (_: Throwable) {}
            // Fallback: file://
            try {
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(Uri.fromFile(file), "*/*")
                    flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                activity.startActivity(intent)
            } catch (_: Throwable) {}
        }

        /**
         * Tenta abrir um app externo (AetherSX2, DuckStation, etc) passando o ROM.
         * Retorna true se conseguiu, false se app nao instalado.
         */
        @JvmStatic
        fun launchExternalEmulator(activity: Activity, packageName: String, romPath: String): Boolean {
            return try {
                val pm = activity.packageManager
                val launchIntent = pm.getLaunchIntentForPackage(packageName) ?: return false
                val file = File(romPath)
                val uri = if (romPath.startsWith("/storage/emulated/0/Download")) {
                    // FileProvider pra arquivos no Download
                    try {
                        FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
                    } catch (_: Throwable) { Uri.fromFile(file) }
                } else {
                    Uri.fromFile(file)
                }
                launchIntent.apply {
                    action = Intent.ACTION_VIEW
                    setDataAndType(uri, "application/octet-stream")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                activity.startActivity(launchIntent)
                true
            } catch (_: ActivityNotFoundException) { false } catch (_: Throwable) { false }
        }

        /**
         * Abre Play Store pra instalar app, fallback web se Play Store nao tiver.
         */
        @JvmStatic
        fun openPlayStorePage(activity: Activity, packageName: String) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                activity.startActivity(intent)
            } catch (_: Throwable) {
                try {
                    val intent = Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=$packageName"))
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    activity.startActivity(intent)
                } catch (_: Throwable) {}
            }
        }

        /**
         * Verifica se um package esta instalado no device.
         */
        @JvmStatic
        fun isPackageInstalled(activity: Activity, packageName: String): Boolean {
            return try {
                activity.packageManager.getPackageInfo(packageName, 0)
                true
            } catch (_: Throwable) { false }
        }

        /**
         * Dispara o installer do Android pra um .apk previamente baixado.
         * Path deve estar no cache_dir do app pra FileProvider conseguir expor.
         */
        @JvmStatic
        fun installApk(activity: Activity, apkAbsPath: String): Boolean {
            return try {
                val file = File(apkAbsPath)
                if (!file.exists() || file.length() < 1024) return false
                val uri = FileProvider.getUriForFile(
                    activity, activity.packageName + ".update", file
                )
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                activity.startActivity(intent)
                true
            } catch (_: Throwable) { false }
        }

        /**
         * Path absoluto do cache_dir/updates onde o APK e baixado.
         */
        @JvmStatic
        fun updateCacheDir(activity: Activity): String {
            val dir = File(activity.cacheDir, "updates")
            try { dir.mkdirs() } catch (_: Throwable) {}
            return dir.absolutePath
        }
    }
}
