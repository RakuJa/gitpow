use std::fs;
use std::path::Path;
use std::collections::BTreeMap;

fn extract_version(version: &toml::Value) -> String {
    match version {
        toml::Value::String(s) => s.clone(),
        toml::Value::Table(t) => {
            if let Some(v) = t.get("version") {
                if let toml::Value::String(s) = v {
                    return s.clone();
                }
            }
            "?".to_string()
        }
        _ => "?".to_string(),
    }
}

fn parse_cargo_toml(path: &Path) -> Result<BTreeMap<String, String>, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(path)?;
    let doc: toml::Value = toml::from_str(&content)?;
    
    let mut deps = BTreeMap::new();
    
    // Parse [dependencies]
    if let Some(deps_table) = doc.get("dependencies").and_then(|d| d.as_table()) {
        for (name, version) in deps_table {
            let version_str = extract_version(version);
            deps.insert(name.clone(), version_str);
        }
    }
    
    // Parse [build-dependencies]
    if let Some(build_deps) = doc.get("build-dependencies").and_then(|d| d.as_table()) {
        for (name, version) in build_deps {
            let version_str = extract_version(version);
            deps.insert(name.clone(), version_str);
        }
    }
    
    Ok(deps)
}

fn parse_package_json(path: &Path) -> Result<BTreeMap<String, String>, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(path)?;
    let doc: serde_json::Value = serde_json::from_str(&content)?;
    
    let mut deps = BTreeMap::new();
    
    if let Some(deps_table) = doc.get("dependencies").and_then(|d| d.as_object()) {
        for (name, version) in deps_table {
            let version_str = version.as_str().unwrap_or("?").to_string();
            deps.insert(name.clone(), version_str);
        }
    }
    
    Ok(deps)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut all_deps: BTreeMap<String, String> = BTreeMap::new();
    
    // Parse root Cargo.toml
    let root_cargo = Path::new("Cargo.toml");
    if root_cargo.exists() {
        let deps = parse_cargo_toml(root_cargo)?;
        for (name, version) in deps {
            all_deps.insert(name, version);
        }
    }
    
    // Parse src-tauri/Cargo.toml
    let tauri_cargo = Path::new("src-tauri/Cargo.toml");
    if tauri_cargo.exists() {
        let deps = parse_cargo_toml(tauri_cargo)?;
        for (name, version) in deps {
            // Prefer tauri-specific versions
            all_deps.insert(name, version);
        }
    }
    
    // Parse package.json
    let package_json = Path::new("package.json");
    if package_json.exists() {
        let deps = parse_package_json(package_json)?;
        for (name, version) in deps {
            all_deps.insert(name, version);
        }
    }
    
    // Also check for Three.js in index.html importmap
    let index_html = Path::new("static/index.html");
    if index_html.exists() {
        let content = fs::read_to_string(index_html)?;
        if content.contains("three@") {
            // Extract version from importmap
            if let Some(start) = content.find("three@") {
                let end = content[start + 6..].find("/").unwrap_or(10);
                let version = &content[start + 6..start + 6 + end];
                all_deps.insert("three".to_string(), version.to_string());
            }
        }
    }
    
    // Generate JavaScript file
    let output_dir = Path::new("static");
    let output_file = output_dir.join("libraries.js");
    
    let mut js_content = String::from("// Auto-generated file - do not edit manually\n");
    js_content.push_str("// This file is generated during build from Cargo.toml and package.json\n\n");
    js_content.push_str("window.EXTERNAL_LIBRARIES = [\n");
    
    // Sort and format libraries
    let mut sorted_deps: Vec<_> = all_deps.iter().collect();
    sorted_deps.sort_by_key(|(name, _)| name.to_lowercase());
    
    for (i, (name, version)) in sorted_deps.iter().enumerate() {
        let name_clean = name.replace("-", "-");
        let version_clean = version.trim_start_matches("^").trim_start_matches("~");
        js_content.push_str(&format!("  {{ name: \"{}\", version: \"{}\" }}{}\n", 
            name_clean, version_clean, if i < sorted_deps.len() - 1 { "," } else { "" }));
    }
    
    js_content.push_str("];\n");
    
    fs::write(&output_file, js_content)?;
    println!("cargo:warning=Generated libraries.js at {:?}", output_file);
    
    Ok(())
}

