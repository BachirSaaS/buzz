import { Terminal } from "lucide-react";

import { ScrollFadeMonoPanel } from "../FileContentBlock";
import { parseShellToolOutput } from "../agentSessionUtils";

export function ShellCommandBlock({
  command,
  result,
}: {
  command: string;
  result: string;
}) {
  const output = parseShellToolOutput(result);
  const stdout = output.stdout.trimEnd();

  return (
    <div
      className="overflow-hidden rounded-blockui-md bg-muted font-mono text-xs leading-5"
      data-testid="transcript-shell-command"
    >
      <ScrollFadeMonoPanel
        fadeFromClassName="from-muted"
        maxHeightClassName="max-h-36"
      >
        <p className="whitespace-pre-wrap wrap-break-word text-muted-foreground">
          <Terminal className="mr-2 inline size-4 align-text-bottom text-primary" />
          {command}
        </p>
      </ScrollFadeMonoPanel>
      {stdout ? (
        <ScrollFadeMonoPanel
          className="mt-2"
          fadeFromClassName="from-muted"
          maxHeightClassName="max-h-36"
        >
          <pre className="whitespace-pre-wrap wrap-break-word text-foreground">
            {stdout}
          </pre>
        </ScrollFadeMonoPanel>
      ) : null}
    </div>
  );
}
