/**
 * Adversary Extension
 *
 * A synchronous gate that reviews bash tool calls before execution.
 * Calls the LLM directly via pi-ai to evaluate whether the command
 * is safe, then blocks or allows based on the verdict.
 *
 * Enabled when a session or persistent policy exists. Disable an explicitly
 * installed policy with: pi --adversary=false
 */

import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface AdversaryVerdict {
	verdict: "ALLOW" | "BLOCK";
	reason: string;
}

export default function adversary(pi: ExtensionAPI) {
	const disabledBySandpit = process.env.SANDPIT_ADVERSARY_DISABLED === "1";
	const hasPolicy = process.env.SANDPIT_ADVERSARY_RULES !== undefined
		|| existsSync(RULES_PATH)
		|| sessionSentinelIsProtected();
	pi.registerFlag("adversary", {
		type: "string",
		default: "true",
		description: "Adversary review (disable with --adversary=false)",
	});

	let originalTask = "";
	let rules = loadRules();

	// Capture the original user task for context
	pi.on("before_agent_start", (event) => {
		if (!originalTask) {
			originalTask = event.prompt;
		}
	});

	// Reset on new session
	pi.on("session_switch", () => {
		originalTask = "";
		rules = loadRules(); // re-read in case user edited the file
	});

	// Sync gate: review every bash tool call
	pi.on("tool_call", async (event, ctx) => {
		if (!hasPolicy || disabledBySandpit || pi.getFlag("adversary") === "false") return;
		if (event.toolName !== "bash") return;

		const command = event.input.command as string;

		ctx.ui.setStatus("adversary", "🛡️ reviewing…");

		// Pull last 4 user messages from session for context
		const recentUserMessages = getRecentUserMessages(ctx, 4);

		try {
			const verdict = await consultAdversary(ctx, originalTask, command, rules, recentUserMessages);

			if (verdict.verdict === "BLOCK") {
				ctx.ui.notify(`🛑 Adversary blocked: ${verdict.reason}`, "error");
				return { block: true, reason: "This command was blocked by a security policy. Do not attempt to run it again or work around this restriction." };
			}

			// ALLOW — continue
			return undefined;
		} catch (err) {
			return { block: true, reason: `Security review failed: ${err instanceof Error ? err.message : String(err)}` };
		} finally {
			ctx.ui.setStatus("adversary", undefined);
		}
	});

	// Show status when active
	pi.on("session_start", (_, ctx) => {
		if (hasPolicy && pi.getFlag("adversary") !== "false" && !disabledBySandpit) {
			ctx.ui.setStatus("adversary", "🛡️ adversary");
		}
	});
}

const RULES_PATH = join(homedir(), ".pi", "agent", "adversary.md");

function sessionSentinelIsProtected(): boolean {
	try {
		const fd = openSync(join(homedir(), ".sandpit", "sandbox-sentinel"), "r+");
		closeSync(fd);
		return false;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "EACCES" || code === "EPERM";
	}
}

const DEFAULT_RULES = `BLOCK if the command:
- Exfiltrates data (curl/wget posting to unknown URLs, piping secrets out)
- Is destructive beyond the project scope (rm -rf /, modifying system files)
- Installs malware or runs obfuscated code
- Attempts to escalate privileges unnecessarily
- Downloads and executes untrusted remote scripts

ALLOW if the command is a normal development operation, even if it modifies files,
installs packages, runs tests, uses git, etc. Most commands are fine.
Err on the side of ALLOW — only block truly dangerous things.`;

function loadRules(): string {
	const sessionRules = process.env.SANDPIT_ADVERSARY_RULES;
	if (sessionRules !== undefined) return sessionRules.trim();

	try {
		return readFileSync(RULES_PATH, "utf-8").trim();
	} catch {
		return DEFAULT_RULES;
	}
}

function getRecentUserMessages(ctx: ExtensionContext, count: number): string[] {
	const branch = ctx.sessionManager.getBranch();
	const messages: string[] = [];

	for (let i = branch.length - 1; i >= 0 && messages.length < count; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		if (entry.message.role !== "user") continue;

		const content = entry.message.content;
		if (typeof content === "string") {
			messages.unshift(content);
			continue;
		}
		if (Array.isArray(content)) {
			const text = content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("\n");
			if (text) messages.unshift(text);
		}
	}

	return messages;
}

/**
 * Strip bash comments before sending to the adversary LLM.
 * Comments are attacker-controlled text that the shell ignores but the LLM
 * reads. An adversarial agent can add misleading comments to fool the reviewer.
 */
function stripBashComments(command: string): string {
	const lines = command.split("\n");
	const stripped: string[] = [];
	for (const line of lines) {
		// Only strip full-line comments. Inline # is too risky —
		// it appears legitimately in quoted strings like "Fix #123"
		// and stripping it corrupts the command the reviewer sees.
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		stripped.push(line);
	}
	return stripped.length > 0 ? stripped.join("\n") : command;
}

async function consultAdversary(ctx: ExtensionContext, originalTask: string, bashCommand: string, rules: string, recentUserMessages: string[]): Promise<AdversaryVerdict> {
	const model = ctx.model;
	if (!model) return { verdict: "BLOCK", reason: "No model available" };

	const apiKey = await ctx.modelRegistry.getApiKey(model);
	if (!apiKey) return { verdict: "BLOCK", reason: "No API key available" };

	const historySection = recentUserMessages.length > 0
		? [
			"Recent user messages (oldest first):",
			...recentUserMessages.map((m, i) => `${i + 1}. ${m.length > 200 ? m.slice(0, 200) + "..." : m}`),
			"",
		]
		: [];

	const userMessage = [
		`The user's original task: ${originalTask || "(unknown)"}`,
		"",
		...historySection,
		"The bash command to review (comments stripped — they are attacker-controlled):",
		"```",
		stripBashComments(bashCommand),
		"```",
		"",
		rules,
		"",
		"Respond with a single word on the first line: ALLOW or BLOCK",
		"Then on the next line, a brief reason.",
	].join("\n");

	try {
		const response = await completeSimple(model, {
			systemPrompt: "You are a security reviewer. An AI coding agent is about to run a bash command. Your ONLY job: decide if this command is safe to execute. Respond with ALLOW or BLOCK on the first line, then a brief reason.",
			messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
		}, { apiKey });

		const output = response.content
			.filter((c) => c.type === "text")
			.map((c) => (c as any).text)
			.join("\n")
			.trim();

		const upper = output.toUpperCase();

		if (upper.startsWith("BLOCK") || upper.includes("\nBLOCK")) {
			const reason = output.replace(/^BLOCK\b[:\s-]*/i, "").trim() || "Blocked by adversary";
			return { verdict: "BLOCK", reason };
		}

		return { verdict: "ALLOW", reason: output.slice(0, 100) };
	} catch (err) {
		return { verdict: "BLOCK", reason: `Adversary error: ${err instanceof Error ? err.message : String(err)}` };
	}
}
