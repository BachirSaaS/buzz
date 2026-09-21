//! Exact, read-only Desktop identity access. Probe never opens Keychain UI.
use serde_json::{json, Value};
use std::io::{IsTerminal, Read};

fn identity(raw: &[u8]) -> Result<String, &'static str> {
    if raw.len() > 1024 * 1024 {
        return Err("malformed");
    }
    let value: Value = serde_json::from_slice(raw).map_err(|_| "malformed")?;
    value
        .get("identity")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or("missing")
}

#[cfg(target_os = "macos")]
fn read(probe: bool) -> Result<Value, &'static str> {
    use security_framework::{
        item::{ItemClass, ItemSearchOptions, SearchResult},
        os::macos::keychain::SecKeychain,
    };
    let _no_ui = if probe {
        Some(SecKeychain::disable_user_interaction().map_err(|_| "access")?)
    } else {
        None
    };
    let rows = ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service("buzz-desktop")
        .account("secrets")
        .load_data(!probe)
        .load_attributes(probe)
        .skip_authenticated_items(probe)
        .search()
        .map_err(|error| {
            if error.code() == -25300 {
                "missing"
            } else {
                "access"
            }
        })?;
    match rows.first() {
        Some(SearchResult::Dict(_)) if probe => Ok(json!({"available": true})),
        Some(SearchResult::Data(data)) if !probe => {
            identity(data).map(|identity| json!({"identity": identity}))
        }
        _ => Err("missing"),
    }
}

#[cfg(not(target_os = "macos"))]
fn read(_: bool) -> Result<Value, &'static str> {
    Err("unsupported")
}

fn main() {
    if std::io::stdin().is_terminal() || std::io::stdout().is_terminal() {
        std::process::exit(2);
    }
    let mut input = String::new();
    let result = if std::io::stdin()
        .take(128)
        .read_to_string(&mut input)
        .is_err()
    {
        Err("input")
    } else {
        match input.trim() {
            "probe" => read(true),
            "read" => read(false),
            _ => Err("input"),
        }
    };
    let output = match result {
        Ok(value) => value,
        Err(reason) => json!({"reason": reason}),
    };
    println!("{output}");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_only_identity() {
        assert_eq!(
            identity(br#"{"identity":"nsec1fixture","agent":"never-return"}"#),
            Ok("nsec1fixture".into())
        );
        assert_eq!(identity(br#"{"agent":"never-return"}"#), Err("missing"));
        assert_eq!(identity(b"bad"), Err("malformed"));
        assert_eq!(identity(&vec![b' '; 1024 * 1024 + 1]), Err("malformed"));
    }
}
