import {
  currentCommandMemory,
  rememberCommand,
  type CommandMemory,
} from "./commandMemory";
import { useEffect, useRef, useState } from "react";
import { useAppShell } from "@/app/AppShellContext";
import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useIsArchivedPredicate } from "@/features/identity-archive/hooks";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  getMentionableAgentPubkeys,
  getSharedChannelIds,
} from "@/features/agents/lib/agentAutocompleteEligibility";
import { useWindowCatalog } from "../lib/useWindowCatalog";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import type { PulseWorkspaces } from "../lib/pulseWorkspaces";
import { captureCanvasFrames } from "../lib/freeformCanvas";
import {
  actionQuestion,
  resolveIntent,
  selectDecision,
  type InterfaceAction,
} from "./intent";
import {
  DRAFT_WINDOW,
  decodePlan,
  parameterQuestions,
  type CommandContext,
  type InterfacePlan,
} from "./plan";
import { discoverCommandRecipients } from "./recipientDirectory";
import { executeInterfacePlan } from "./execute";
import { parseWorkspaceIcons } from "../lib/workspaceIcons";
import { commandEntries, directCommand } from "./commandCatalog";
import { workspaceNavigation } from "./workspaceNavigation";

import { rememberRecipientAlias, personName } from "./recipients";
import {
  resolveRecipients,
  recipientFollowupQuestion,
  type RecipientResolution,
} from "./recipientClarification";
type PendingRecipients = RecipientResolution & {
  request: string;
  ctx: CommandContext;
  before: PulseWorkspaces;
  scope: string;
  plan: InterfacePlan;
};

export function useInterfaceCommands(workspaces: WorkspaceController) {
  const catalog = useWindowCatalog();
  const latestCatalog = useRef(catalog);
  latestCatalog.current = catalog;
  const identity = useIdentityQuery();
  const managedAgents = useManagedAgentsQuery();
  const relayAgents = useRelayAgentsQuery();
  const channels = useChannelsQuery();
  const isArchived = useIsArchivedPredicate();
  const { goSettings } = useAppNavigation();
  const { openBrowseChannels, openCreateChannel } = useAppShell();
  const [pending, setPending] = useState<PendingRecipients | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const flight = useRef<AbortController | null>(null);
  const focused = useRef<string | null>(null);
  const lastTarget = useRef<string | null>(null);
  const recent = useRef<CommandMemory | undefined>(undefined);
  const recentScope = useRef(workspaces.scope);
  const undo = useRef<{ before: PulseWorkspaces; after: string } | null>(null);
  const latest = useRef(workspaces);
  latest.current = workspaces;
  const cancel = () => {
    if (flight.current || pending) setFeedback("Command cancelled.");
    flight.current?.abort();
    flight.current = null;
    setError(null);
    setBusy(false);
    setPending(null);
  };
  useEffect(() => {
    const remember = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const content = event.target.closest<HTMLElement>(
        "[data-content-id], [data-canvas-frame]",
      );
      if (content)
        focused.current =
          content.dataset.contentId ?? content.dataset.canvasFrame ?? null;
    };
    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("focusin", remember, true);
    return () => {
      flight.current?.abort();
      document.removeEventListener("pointerdown", remember, true);
      document.removeEventListener("focusin", remember, true);
    };
  }, []);
  useEffect(() => {
    if (flight.current)
      setFeedback("Command cancelled because the workspace changed.");
    flight.current?.abort();
    flight.current = null;
    focused.current = null;
    if (
      recentScope.current !== workspaces.scope ||
      recent.current?.workspace !== workspaces.active.id
    )
      recent.current = undefined;
    recentScope.current = workspaces.scope;
    setPending(null);
    setBusy(false);
  }, [workspaces.scope, workspaces.active.id]);

  useEffect(() => {
    recent.current = currentCommandMemory(recent.current, workspaces.active);
  }, [workspaces.active]);

  const run = async (
    raw: string,
    chosen?: string,
    live?: {
      action?: InterfaceAction;
      selection?: string;
      signal?: AbortSignal;
      onApply?: () => void;
    },
  ) => {
    if (flight.current) return "busy";
    if (live?.signal?.aborted) return "cancelled";
    const request = raw.trim();
    if (pending && /^(cancel|never mind|nevermind|stop)[.!]?$/i.test(request)) {
      cancel();
      return;
    }
    if (!request || request.length > 1000) {
      setError("Use a command of up to 1,000 characters.");
      return;
    }
    const abort = new AbortController();
    const interrupt = () => abort.abort();
    live?.signal?.addEventListener("abort", interrupt, { once: true });
    flight.current = abort;
    setBusy(true);
    setError(null);
    setFeedback("Understanding your command…");
    const before = pending?.before ?? workspaces.checkpoint();
    const fingerprint = JSON.stringify(before);
    const scope = pending?.scope ?? workspaces.scope;
    const ensureCurrent = () => {
      if (abort.signal.aborted || flight.current !== abort)
        throw new DOMException("Cancelled", "AbortError");
      if (
        latest.current.scope !== scope ||
        latest.current.active.id !==
          (pending?.ctx.active.id ?? workspaces.active.id) ||
        JSON.stringify(latest.current.checkpoint()) !== fingerprint
      )
        throw new Error(
          "Your workspace changed while Jev was thinking. Run the command again here.",
        );
    };
    try {
      if (!scope || !catalog.ready)
        throw new Error(
          "Wait for your community's windows to load, then try again.",
        );
      ensureCurrent();
      const ctx: CommandContext = pending
        ? { ...pending.ctx }
        : {
            active: workspaces.active,
            workspaces: workspaces.items,
            catalog: catalog.views,
            people: [],
            focused:
              focused.current ??
              (lastTarget.current &&
              workspaces.active.canvas.windows.includes(lastTarget.current)
                ? lastTarget.current
                : null),
          };
      ctx.recent = currentCommandMemory(recent.current, ctx.active);
      ctx.workspaceIcons = Object.fromEntries(
        Object.entries(
          parseWorkspaceIcons(
            localStorage.getItem(`buzz-workspace-icons.v1:${scope}`),
          ),
        ).map(([id, record]) => [id, record.icon]),
      );
      const context = JSON.stringify({
        workspace: ctx.active.name,
        workspaces: ctx.workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          current: workspace.id === ctx.active.id,
          icon: workspace.icon ?? ctx.workspaceIcons?.[workspace.id],
          windows: workspace.canvas.windows.map(
            (id) => ctx.catalog.find((view) => view.id === id)?.title ?? id,
          ),
        })),
        recentCommand: ctx.recent,
        focused: ctx.focused,
        windows: ctx.active.canvas.windows,
        availableViews: ctx.catalog
          .filter((view) => view.kind === "app")
          .map((view) => ({ title: view.title, purpose: view.description })),
      });
      const spec = actionQuestion();
      const entries = commandEntries(ctx);
      const selected = live?.selection
        ? entries.find((entry) => entry.id === live.selection)?.plan
        : null;
      if (live?.selection && !selected)
        throw new Error("That destination is no longer available.");
      let navigation = !pending ? selected : null;
      let classified = null;
      if (!pending && !live?.action && !navigation) {
        try {
          classified = await resolveIntent(
            { request, context, questions: { action: spec } },
            abort.signal,
          );
          selectDecision(classified, "action", spec);
        } catch (cause) {
          // Exact local destinations remain a recovery path if Jev is unavailable.
          if (abort.signal.aborted) throw cause;
          navigation =
            workspaceNavigation(request, ctx.workspaces) ??
            directCommand(request, entries);
          if (!navigation) throw cause;
        }
      }
      ensureCurrent();
      const action = pending
        ? pending.plan.action
        : (navigation?.action ??
          live?.action ??
          (selectDecision(
            classified ?? {},
            "action",
            spec,
          ) as InterfaceAction));
      if (action === "unsupported")
        throw new Error(
          "I couldn’t match that action yet. Choose a destination below, or try “show my projects”, “browse agents”, or “search Buzz for …”.",
        );
      if (action === "undo") {
        if (!undo.current || undo.current.after !== fingerprint)
          throw new Error(
            "There isn't a command to undo here, or the workspace has changed since it ran.",
          );
        live?.onApply?.();
        if (!workspaces.restore(undo.current.before))
          throw new Error("Undo was cancelled or couldn't be saved.");
        undo.current = null;
        recent.current = undefined;
        setFeedback("Command undone.");
        return;
      }
      if (
        action === "browse_channels" ||
        action === "new_channel" ||
        action === "new_agent"
      ) {
        ensureCurrent();
        live?.onApply?.();
        if (action === "browse_channels") openBrowseChannels();
        else if (action === "new_channel") openCreateChannel();
        else requestOpenCreateAgent();
        setFeedback(
          action === "browse_channels"
            ? "Channel directory opened."
            : "Creation form opened.",
        );
        return "applied";
      }
      let plan: InterfacePlan;
      if (pending) plan = pending.plan;
      else if (navigation) plan = navigation;
      else if (action === "new_dm") plan = { action };
      else {
        const questions = parameterQuestions(action, request, ctx);
        const answers = await resolveIntent(
          { request, context, questions },
          abort.signal,
        );
        ensureCurrent();
        plan = decodePlan(action, questions, answers, ctx);
      }
      if (action === "open_settings") {
        ensureCurrent();
        live?.onApply?.();
        const opened = await goSettings(plan.section);
        if (!abort.signal.aborted)
          setFeedback(
            opened ? "Settings opened." : "Settings navigation unchanged.",
          );
        return opened ? "applied" : undefined;
      }
      if (
        (action === "new_dm" && !navigation) ||
        plan.windowIds?.includes(DRAFT_WINDOW)
      ) {
        if (
          !managedAgents.isSuccess ||
          !relayAgents.isSuccess ||
          !channels.isSuccess
        )
          throw new Error(
            "The recipient directory is still loading. Try again shortly.",
          );
        const eligibleAgents = getMentionableAgentPubkeys({
          currentPubkey: identity.data?.pubkey,
          eligibilityScope: { type: "community" },
          managedAgentPubkeys: managedAgents.data.map((a) => a.pubkey),
          relayAgents: relayAgents.data,
          sharedChannelIds: getSharedChannelIds(channels.data),
        });
        setFeedback("Finding recipients…");
        ctx.people = await discoverCommandRecipients(
          pending
            ? `${pending.names[pending.recipients.indexOf(null)] ?? ""} ${request}`
            : request,
          ctx,
          catalog.people,
          channels.data,
          scope,
          (person) =>
            person.pubkey !== identity.data?.pubkey &&
            (!person.isAgent || eligibleAgents.has(person.pubkey)) &&
            !isArchived(person.pubkey),
        );
        ensureCurrent();
        let resolution: RecipientResolution;
        if (pending) {
          resolution = {
            names: pending.names,
            recipients: [...pending.recipients],
          };
          const slot = resolution.recipients.indexOf(null);
          const spec = recipientFollowupQuestion(
            ctx.people,
            resolution.recipients,
            pending.ctx.people
              .filter((p) => !pending.recipients.includes(p.pubkey))
              .slice(0, 6)
              .map((p) => p.pubkey),
          );
          let selected = chosen;
          if (!selected) {
            const answers = await resolveIntent(
              {
                request,
                context: `Original request: ${pending.request}. Clarifying ${pending.names[slot] ?? `recipient ${slot + 1}`}.`,
                questions: { recipient: spec },
              },
              abort.signal,
            );
            ensureCurrent();
            const answer = answers.recipient;
            if (answer?.probability >= 0.5 && answer.margin >= 0.15)
              selected = selectDecision(answers, "recipient", spec);
          }
          if (
            selected &&
            Object.hasOwn(spec.criteria, selected) &&
            ctx.people.some((p) => p.pubkey === selected) &&
            !resolution.recipients.includes(selected)
          ) {
            ensureCurrent();
            resolution.recipients[slot] = selected;
            if (resolution.names[slot])
              rememberRecipientAlias(scope, resolution.names[slot], selected);
          }
        } else {
          const questions = parameterQuestions("new_dm", request, ctx);
          const answers = await resolveIntent(
            { request, context, questions },
            abort.signal,
          );
          ensureCurrent();
          resolution = resolveRecipients(
            request,
            ctx.people,
            questions,
            answers,
          );
        }
        const slot = resolution.recipients.indexOf(null);
        if (slot !== -1) {
          setPending({
            ...resolution,
            plan,
            ctx,
            before,
            scope,
            request: pending?.request ?? request,
          });
          setFeedback(
            `Who do you mean by ${resolution.names[slot] ? `“${resolution.names[slot]}”` : `recipient ${slot + 1}`}? Choose someone below, or say their full name or username.`,
          );
          return;
        }
        plan = {
          ...plan,
          recipients: resolution.recipients.filter(
            (id): id is string => id !== null,
          ),
        };
      }
      ensureCurrent();
      if (
        !allowNavigation({
          kind: "route",
          href: `/pulse?workspace=${workspaces.active.id}`,
        })
      )
        throw new Error("Command cancelled to keep your current work open.");
      const canvas = document.querySelector<HTMLElement>(
        '[data-testid="pulse-canvas"]',
      );
      const bounds = {
        width: canvas?.clientWidth || 960,
        height: canvas?.clientHeight || 640,
      };
      const frames = captureCanvasFrames(canvas);
      if (!latestCatalog.current.ready)
        throw new Error(
          "Your available windows changed. Try again after they finish loading.",
        );
      ctx.catalog = latestCatalog.current.views;
      live?.onApply?.();
      const message = executeInterfacePlan(
        plan,
        ctx,
        workspaces,
        bounds,
        frames,
      );
      const after = workspaces.checkpoint();
      const activeAfter = after.items.find((w) => w.id === after.active);
      recent.current = activeAfter
        ? rememberCommand(plan, request, ctx.active, activeAfter)
        : undefined;
      lastTarget.current =
        plan.target ??
        plan.windowIds?.at(-1) ??
        activeAfter?.canvas.windows.at(-1) ??
        null;
      const undoBefore =
        action === "close_workspace" || action === "close_other_workspaces"
          ? {
              ...before,
              items: before.items.map((item) => {
                const icon = item.icon ?? ctx.workspaceIcons?.[item.id];
                return icon ? { ...item, icon } : item;
              }),
            }
          : before;
      undo.current = { before: undoBefore, after: JSON.stringify(after) };
      if (plan.target && action === "focus_window") {
        const applied = JSON.stringify(workspaces.checkpoint());
        requestAnimationFrame(() => {
          if (
            latest.current.scope !== scope ||
            JSON.stringify(latest.current.checkpoint()) !== applied
          )
            return;
          const content = [
            ...(canvas?.querySelectorAll<HTMLElement>(
              "[data-content-id], [data-canvas-frame]",
            ) ?? []),
          ].find(
            (el) =>
              (el.dataset.contentId ?? el.dataset.canvasFrame) === plan.target,
          );
          content?.scrollIntoView({ block: "nearest", inline: "nearest" });
          content
            ?.querySelector<HTMLElement>("button, input, [tabindex]")
            ?.focus();
        });
      }
      setPending(null);
      setFeedback(message);
      return "applied";
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setFeedback("");
      }
    } finally {
      live?.signal?.removeEventListener("abort", interrupt);
      if (flight.current === abort) {
        flight.current = null;
        setBusy(false);
      }
    }
  };
  const suggestions =
    pending?.ctx.people
      .filter((p) => !pending.recipients.includes(p.pubkey))
      .slice(0, 6) ?? [];
  return {
    entries: commandEntries({
      catalog: catalog.views,
      workspaces: workspaces.items,
    }),
    runEntry: (id: string) => run(id, undefined, { selection: id }),
    busy,
    ready: catalog.ready,
    catalogError: catalog.error,
    retryCatalog: catalog.retry,
    feedback,
    error,
    run,
    cancel,
    clarifying: Boolean(pending),
    suggestions,
    liveContext: () => ({
      token: `${workspaces.scope}:${JSON.stringify(workspaces.checkpoint())}`,
      description: `Workspace: ${workspaces.active.name}. Open windows: ${workspaces.active.canvas.windows.join(", ")}. ${pending ? feedback : ""} Last successful command: ${JSON.stringify(currentCommandMemory(recent.current, workspaces.active) ?? null)}. Pronoun follow-ups may use that reference.`,
      clarifying: Boolean(pending),
    }),
    choose: (pubkey: string) => {
      const person = suggestions.find((p) => p.pubkey === pubkey);
      if (person) return run(personName(person), pubkey);
    },
  };
}
