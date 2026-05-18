# Add project specific ProGuard rules here.

# Tauri/Wry: tao crate chama metodos por reflection JNI (string literal "getId",
# "onActivityCreate" etc). Sem -keep, R8 renomeia e tao crasha com JavaException
# em onActivityCreate (panic 'Result::unwrap() on Err: JavaException').
-keep class gg.ludex.app.WryActivity { *; }
-keep class gg.ludex.app.RustWebView { *; }
-keep class gg.ludex.app.RustWebViewClient { *; }
-keep class gg.ludex.app.RustWebChromeClient { *; }
-keep class gg.ludex.app.Rust { *; }
-keep class gg.ludex.app.Logger { *; }
-keep class gg.ludex.app.MainActivity { *; }
-keep class gg.ludex.app.WryLifecycleObserver { *; }
-keep class gg.ludex.app.Permissions { *; }

# Tauri plugins manager
-keep class gg.ludex.app.TauriActivity { *; }
-keep class app.tauri.** { *; }
