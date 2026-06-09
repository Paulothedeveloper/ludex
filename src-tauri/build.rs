fn main() {
  guard_release_secrets();
  tauri_build::build()
}

/// Impede gerar um binario de RELEASE sem credenciais Gumroad reais.
///
/// O license gate do frontend (LudexLauncher.jsx) libera o app inteiro quando o
/// backend reporta token "PLACEHOLDER" — atalho proposital pra builds de DEV. Se
/// um build de release saisse por engano com `secrets.rs.example` (placeholder),
/// o app iria pra producao SEM trava de licenca. Esta checagem em tempo de build
/// torna isso impossivel: so morde `--release`, builds de dev seguem normais.
fn guard_release_secrets() {
  println!("cargo:rerun-if-changed=src/secrets.rs");
  let profile = std::env::var("PROFILE").unwrap_or_default();
  if profile != "release" {
    return; // dev/debug pode usar PLACEHOLDER
  }
  let content = std::fs::read_to_string("src/secrets.rs").unwrap_or_default();
  if content.trim().is_empty() {
    panic!(
      "\n\n[ludex] RELEASE BLOQUEADO: src-tauri/src/secrets.rs nao existe.\n\
       Copie secrets.rs.example -> secrets.rs e preencha as credenciais reais do\n\
       Gumroad antes de buildar release (senao o app sai SEM trava de licenca).\n\n"
    );
  }
  if content.contains("PLACEHOLDER_ACCESS_TOKEN")
    || content.contains("PLACEHOLDER_PRODUCT_PERMALINK")
  {
    panic!(
      "\n\n[ludex] RELEASE BLOQUEADO: src-tauri/src/secrets.rs ainda tem PLACEHOLDER.\n\
       Preencha GUMROAD_PRODUCT_ID e GUMROAD_ACCESS_TOKEN com os valores reais\n\
       antes de buildar release (senao o license gate fica desativado).\n\n"
    );
  }
}
