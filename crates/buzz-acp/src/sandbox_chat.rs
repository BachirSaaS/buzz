//! Interactive local demo through the same ACP spawn/session seam as relay workers.
use anyhow::{Context, Result};
use clap::Parser;
use std::io::{BufRead, Read};

#[derive(Parser)]
struct Args {
    /// Host-local JSON policy (see docs/sandpit-poc.md).
    #[arg(long)]
    policy: std::path::PathBuf,
    /// ACP adapter executable. Arguments are separate --arg values.
    #[arg(long)]
    agent_command: String,
    #[arg(long = "arg", allow_hyphen_values = true)]
    agent_args: Vec<String>,
    /// Workspace passed to ACP session/new (launch from this directory as well).
    #[arg(long, default_value = ".")]
    workspace: std::path::PathBuf,
    /// Optional local MCP tool server; runs as a descendant of the adapter.
    #[arg(long)]
    mcp_command: Option<String>,
    /// Run one prompt and exit. Omit to chat interactively; /quit exits.
    #[arg(long)]
    prompt: Option<String>,
}

pub(crate) async fn run() -> Result<()> {
    let args = Args::parse_from(
        std::env::args()
            .enumerate()
            .filter(|(i, _)| *i != 1)
            .map(|(_, a)| a),
    );
    anyhow::ensure!(
        args.prompt
            .as_ref()
            .is_none_or(|prompt| !prompt.trim().is_empty()),
        "prompt must not be empty"
    );
    crate::security::install_file(&args.policy)?;
    let workspace = args.workspace.canonicalize()?;
    std::env::set_current_dir(&workspace)?;
    tracing_subscriber::fmt()
        .with_target(false)
        .without_time()
        .with_env_filter("buzz_acp=info,acp::stream=info,acp::tool=info")
        .with_writer(std::io::stderr)
        .init();
    let mut client =
        crate::acp::AcpClient::spawn(&args.agent_command, &args.agent_args, &[], false).await?;
    let interaction = async {
        tokio::time::timeout(std::time::Duration::from_secs(60), client.initialize()).await??;
        let policy = crate::security::configured()?.context("demo requires protection")?;
        eprintln!(
            "Protected — kernel startup check passed; ACP initialized.\nPolicy: {}",
            policy.digest
        );
        eprintln!("Local host confinement PoC. Buzz credentials and remote tool authority are separate controls.");
        let servers: Vec<crate::acp::McpServer> = args
            .mcp_command
            .map(|command| crate::acp::McpServer {
                name: "workspace-tools".into(),
                command,
                args: vec![],
                env: vec![],
            })
            .into_iter()
            .collect();
        let mut session = client
            .session_new(&workspace.to_string_lossy(), servers.clone(), None, None)
            .await?;
        // A dedicated OS thread avoids Tokio's uncancellable stdin blocking task,
        // which otherwise prevents runtime shutdown on Ctrl-C at the prompt.
        let (tx, mut lines) = tokio::sync::mpsc::channel(1);
        if args.prompt.is_none() {
            std::thread::spawn(move || {
                let stdin = std::io::stdin();
                let mut input = stdin.lock();
                loop {
                    let mut line = String::new();
                    let read = (&mut input).take(65 * 1024).read_line(&mut line);
                    if matches!(read, Ok(0)) {
                        break;
                    }
                    if tx.blocking_send(read.map(|_| line)).is_err() {
                        break;
                    }
                }
            });
        }
        loop {
            let prompt = if let Some(prompt) = &args.prompt {
                prompt.clone()
            } else {
                eprintln!("\nType a task (/restart for a fresh agent, /quit to exit):");
                match lines.recv().await.transpose()? {
                    Some(line) if line.trim() != "/quit" => line,
                    _ => break,
                }
            };
            if prompt.trim().is_empty() {
                continue;
            }
            if args.prompt.is_none() && prompt.trim() == "/restart" {
                client.shutdown().await;
                client =
                    crate::acp::AcpClient::spawn(&args.agent_command, &args.agent_args, &[], false)
                        .await?;
                tokio::time::timeout(std::time::Duration::from_secs(60), client.initialize())
                    .await??;
                session = client
                    .session_new(&workspace.to_string_lossy(), servers.clone(), None, None)
                    .await?;
                eprintln!(
                    "Restarted under the same immutable policy: {}",
                    policy.digest
                );
                continue;
            }
            anyhow::ensure!(prompt.len() <= 64 * 1024, "prompt exceeds 64 KiB");
            let stop = client
                .session_prompt_with_idle_timeout(
                    &session,
                    &prompt,
                    std::time::Duration::from_secs(120),
                    std::time::Duration::from_secs(600),
                )
                .await?;
            eprintln!("Turn complete: {stop:?}");
            if args.prompt.is_some() {
                break;
            }
        }
        Ok(())
    };
    let outcome: Result<()> = tokio::select! {
        result = interaction => result,
        _ = tokio::signal::ctrl_c() => Ok(()),
    };
    // Includes failed initialization, session creation, prompt errors and Ctrl-C.
    client.shutdown().await;
    outcome
}
