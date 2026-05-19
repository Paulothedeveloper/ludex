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
         * Lanca exception com mensagem clara em vez de retornar false silencioso.
         */
        @JvmStatic
        fun installApk(activity: Activity, apkAbsPath: String): Boolean {
            val file = File(apkAbsPath)
            if (!file.exists()) throw IllegalStateException("APK nao encontrado em $apkAbsPath")
            if (file.length() < 100_000) throw IllegalStateException("APK invalido (so ${file.length()} bytes - download falhou)")
            // Valida magic bytes ZIP (APK e ZIP): PK\x03\x04
            val hdr = ByteArray(4)
            try {
                file.inputStream().use { it.read(hdr) }
            } catch (e: Throwable) {
                throw IllegalStateException("Nao consegui ler APK: ${e.message}")
            }
            if (hdr[0] != 0x50.toByte() || hdr[1] != 0x4B.toByte() ||
                hdr[2] != 0x03.toByte() || hdr[3] != 0x04.toByte()) {
                throw IllegalStateException("APK corrompido (magic bytes invalidos). Tente novamente.")
            }
            // Em Android 8+ (API 26+), checa permissao REQUEST_INSTALL_PACKAGES (REQUEST_INSTALL_PACKAGES no manifest
            // nao basta — user precisa habilitar 'Instalar de fontes desconhecidas' pro app).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!activity.packageManager.canRequestPackageInstalls()) {
                    // Abre tela de Settings pra user habilitar permissao
                    try {
                        val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.packageName))
                        settingsIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        activity.startActivity(settingsIntent)
                    } catch (_: Throwable) {}
                    throw IllegalStateException("Habilita 'Instalar apps desconhecidos' pro Ludex nas Configuracoes que abriram, depois clica 'Atualizar' de novo.")
                }
            }
            val uri = try {
                FileProvider.getUriForFile(activity, activity.packageName + ".update", file)
            } catch (e: Throwable) {
                throw IllegalStateException("FileProvider falhou: ${e.message}")
            }
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
            }
            try {
                activity.startActivity(intent)
            } catch (e: ActivityNotFoundException) {
                throw IllegalStateException("Nenhum app instalador disponivel no sistema.")
            } catch (e: Throwable) {
                throw IllegalStateException("Falha ao abrir instalador: ${e.message}")
            }
            return true
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
