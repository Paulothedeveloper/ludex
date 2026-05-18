package gg.ludex.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings

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
    }
}
