//! Explicit integration with Codex when Seatbelt supplies the outer sandbox.

use anyhow::{Result, bail};

pub fn validate_external_sandbox(command: &[String], seatbelt: bool) -> Result<()> {
    if command.first().and_then(|s| s.rsplit('/').next()) != Some("codex") || !seatbelt {
        bail!("--codex-external-sandbox requires a Codex executable running under Seatbelt");
    }
    let mut args = command
        .iter()
        .skip(1)
        .take_while(|arg| arg.as_str() != "--");
    while let Some(arg) = args.next() {
        let config = if arg == "-c" || arg == "--config" {
            args.next().map(String::as_str)
        } else {
            arg.strip_prefix("--config=")
                .or_else(|| arg.strip_prefix("-c="))
                .or_else(|| arg.strip_prefix("-c"))
        };
        let conflicting_config =
            config
                .and_then(|value| value.split_once('='))
                .is_some_and(|(key, _)| {
                    let key = key.trim();
                    [
                        "sandbox_mode",
                        "default_permissions",
                        "allow_login_shell",
                        "features.shell_snapshot",
                        "shell_environment_policy",
                        "profile",
                        "profiles",
                    ]
                    .iter()
                    .any(|protected| {
                        key == *protected
                            || key.starts_with(&format!("{protected}."))
                            || protected.starts_with(&format!("{key}."))
                    })
                });
        let snapshot_feature = if arg == "--enable" || arg == "--disable" {
            args.next()
                .is_some_and(|feature| feature == "shell_snapshot")
        } else {
            arg.strip_prefix("--enable=")
                .or_else(|| arg.strip_prefix("--disable="))
                .is_some_and(|feature| feature == "shell_snapshot")
        };
        if matches!(
            arg.as_str(),
            "-s" | "--sandbox"
                | "--full-auto"
                | "--approve-for-me"
                | "--dangerously-bypass-approvals-and-sandbox"
                | "-p"
                | "--profile"
        ) || arg.starts_with("--sandbox=")
            || arg.starts_with("-s")
            || arg.starts_with("--profile=")
            || arg.starts_with("-p")
            || snapshot_feature
            || conflicting_config
        {
            bail!(
                "remove conflicting Codex sandbox, shell environment, snapshot, or profile options when using --codex-external-sandbox; sandpit supplies these settings for this run"
            );
        }
    }
    Ok(())
}

pub fn external_sandbox_options(env: &[(String, String)]) -> Vec<String> {
    // Do not use --dangerously-bypass-approvals-and-sandbox: changing the
    // sandbox provider must not also turn off the user's approval policy.
    let mut settings = vec![
        "sandbox_mode=\"danger-full-access\"".to_string(),
        "allow_login_shell=false".to_string(),
        "features.shell_snapshot=false".to_string(),
    ];
    // Replace the whole policy: Codex applies include filters after `set`,
    // so pinning only individual set entries is insufficient. Inherit nothing
    // and allow only these explicit values; clearing a user's include filter
    // on an inherited environment could otherwise expose unrelated secrets.
    let mut set = toml::map::Map::new();
    // Without generated shims (for example --no-shims or a files-only policy),
    // preserve the caller's executable search path. A shim override below wins.
    for key in ["PATH", "HOME", "TMPDIR", "SSH_AUTH_SOCK", "USER", "LOGNAME"] {
        if let Ok(value) = std::env::var(key) {
            set.insert(key.into(), toml::Value::String(value));
        }
    }
    for (key, value) in env {
        if key == "PATH"
            || key.starts_with("SANDPIT_")
            || matches!(
                key.as_str(),
                "HTTP_PROXY"
                    | "HTTPS_PROXY"
                    | "ALL_PROXY"
                    | "NO_PROXY"
                    | "http_proxy"
                    | "https_proxy"
                    | "all_proxy"
                    | "no_proxy"
            )
        {
            set.insert(key.clone(), toml::Value::String(value.clone()));
        }
    }
    let keys = set.keys().cloned().map(toml::Value::String).collect();
    let policy = toml::Value::Table(toml::map::Map::from_iter([
        ("inherit".into(), toml::Value::String("none".into())),
        ("set".into(), toml::Value::Table(set)),
        ("include_only".into(), toml::Value::Array(keys)),
        (
            "experimental_use_profile".into(),
            toml::Value::Boolean(false),
        ),
    ]));
    settings.push(format!("shell_environment_policy={policy}"));
    settings
        .into_iter()
        .flat_map(|value| ["-c".to_string(), value])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_mode_requires_codex_and_seatbelt() {
        assert!(validate_external_sandbox(&["codex".into(), "exec".into()], true).is_ok());
        assert!(validate_external_sandbox(&["claude".into()], true).is_err());
        assert!(validate_external_sandbox(&["codex".into()], false).is_err());
        for option in [
            "--sandbox",
            "--sandbox=read-only",
            "-s",
            "-csandbox_mode=\"workspace-write\"",
            "--dangerously-bypass-approvals-and-sandbox",
        ] {
            assert!(validate_external_sandbox(&["codex".into(), option.into()], true).is_err());
        }
        assert!(
            validate_external_sandbox(
                &[
                    "codex".into(),
                    "exec".into(),
                    "-c".into(),
                    "sandbox_mode\t= 'read-only'".into()
                ],
                true
            )
            .is_err()
        );
        assert!(
            validate_external_sandbox(
                &[
                    "codex".into(),
                    "exec".into(),
                    "Explain sandbox_mode=read-only".into()
                ],
                true
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_all_config_spellings_and_parent_tables() {
        for key in [
            "sandbox_mode",
            "default_permissions",
            "allow_login_shell",
            "features",
            "features.shell_snapshot",
            "shell_environment_policy",
            "shell_environment_policy.set",
            "shell_environment_policy.set.PATH",
            "shell_environment_policy.set.SANDPIT_CONFIG",
            "shell_environment_policy.include_only",
            "shell_environment_policy.filters",
            "profile",
            "profiles.custom",
        ] {
            let value = format!("{key}=true");
            for args in [
                vec!["-c".into(), value.clone()],
                vec!["--config".into(), value.clone()],
                vec![format!("-c{value}")],
                vec![format!("-c={value}")],
                vec![format!("--config={value}")],
            ] {
                let mut command = vec!["codex".into(), "exec".into()];
                command.extend(args);
                assert!(
                    validate_external_sandbox(&command, true).is_err(),
                    "{command:?}"
                );
            }
        }
        for args in [
            vec!["--enable", "shell_snapshot"],
            vec!["--enable=shell_snapshot"],
            vec!["--profile", "custom"],
            vec!["-pcustom"],
            vec!["--approve-for-me"],
        ] {
            let mut command = vec!["codex".into()];
            command.extend(args.into_iter().map(String::from));
            assert!(validate_external_sandbox(&command, true).is_err());
        }
        for args in [
            vec!["-c=model=test"],
            vec!["--config", "approval_policy=on-request"],
            vec!["--", "--enable shell_snapshot"],
        ] {
            let mut command = vec!["codex".into(), "exec".into()];
            command.extend(args.into_iter().map(String::from));
            assert!(validate_external_sandbox(&command, true).is_ok());
        }
    }

    #[test]
    fn external_mode_preserves_parent_path_without_shim_override() {
        let parent_path = std::env::var("PATH").expect("test runner requires PATH");
        let options = external_sandbox_options(&[(
            "SANDPIT_CONFIG".into(),
            "/tmp/session/config.toml".into(),
        )]);
        let policy = options
            .iter()
            .find_map(|value| value.strip_prefix("shell_environment_policy="))
            .unwrap();
        let parsed: toml::Table = format!("policy={policy}").parse().unwrap();
        let policy = &parsed["policy"];
        assert_eq!(policy["set"]["PATH"].as_str(), Some(parent_path.as_str()));
        assert!(
            policy["include_only"]
                .as_array()
                .unwrap()
                .contains(&toml::Value::String("PATH".into()))
        );
        assert_eq!(policy["inherit"].as_str(), Some("none"));
        assert_eq!(
            policy["set"]["SANDPIT_CONFIG"].as_str(),
            Some("/tmp/session/config.toml")
        );
    }

    #[test]
    fn external_mode_preserves_approval_and_pins_shim_environment() {
        let options = external_sandbox_options(&[
            ("PATH".into(), "/tmp/shims:/usr/bin".into()),
            ("SANDPIT_CONFIG".into(), "/tmp/session/config.toml".into()),
        ]);
        assert!(options.contains(&"allow_login_shell=false".into()));
        assert!(options.contains(&"features.shell_snapshot=false".into()));
        let policy = options
            .iter()
            .find_map(|value| value.strip_prefix("shell_environment_policy="))
            .unwrap();
        let parsed: toml::Table = format!("policy={policy}").parse().unwrap();
        let policy = &parsed["policy"];
        assert_eq!(policy["inherit"].as_str(), Some("none"));
        assert_eq!(policy["set"]["PATH"].as_str(), Some("/tmp/shims:/usr/bin"));
        assert_eq!(
            policy["set"]["SANDPIT_CONFIG"].as_str(),
            Some("/tmp/session/config.toml")
        );
        let allowed = policy["include_only"].as_array().unwrap();
        assert!(allowed.contains(&toml::Value::String("PATH".into())));
        assert!(allowed.contains(&toml::Value::String("SANDPIT_CONFIG".into())));
        assert!(allowed.iter().all(|key| matches!(
            key.as_str().unwrap(),
            "PATH" | "SANDPIT_CONFIG" | "HOME" | "TMPDIR" | "SSH_AUTH_SOCK" | "USER" | "LOGNAME"
        )));
        assert!(!options.iter().any(|option| option.contains("approval")));
    }
}
