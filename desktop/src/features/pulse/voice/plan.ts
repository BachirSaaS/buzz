import { nudgeChoices, type CommandMemory } from "./commandMemory";
import {
  workspaceIconChoices,
  type WorkspaceIconName,
} from "../lib/workspaceIcons";
import {
  workspaceManagementActions,
  workspacePositionChoices,
} from "./workspaceManagement";
import { commandSettings } from "./commandCatalog";
import { recipientDescription, type CommandRecipient } from "./recipients";
import type { CanvasLayout } from "../lib/canvasLayout";
import type { PulseWorkspace } from "../lib/pulseWorkspaces";
import { canvasContentIds } from "../lib/canvasLayout";
import { canvasWindowView } from "../lib/canvasWindowView";
import { windowTargetOptions, percentageChoices } from "./windowTargets";
import { areaChoices, layoutChoices, sizeChoices } from "./canvasAreas";

export const DRAFT_WINDOW = "draft:message";
import {
  searchWindowCatalog,
  type WindowCatalogEntry,
} from "../lib/windowCatalog";
import {
  question,
  selectDecision,
  transcriptPhrases,
  type InterfaceAction,
  type Decisions,
  type ChoiceQuestion,
} from "./intent";

export type CommandContext = {
  active: PulseWorkspace;
  workspaces: PulseWorkspace[];
  catalog: WindowCatalogEntry[];
  people: CommandRecipient[];
  focused: string | null;
  recent?: CommandMemory;
  workspaceIcons?: Record<string, WorkspaceIconName>;
};
export type InterfacePlan = {
  action: InterfaceAction;
  windowIds?: string[];
  recipients?: string[];
  target?: string;
  section?: string;
  icon?: WorkspaceIconName;
  referenceWorkspace?: string;
  workspacePosition?: keyof typeof workspacePositionChoices;
  targets?: string[];
  percentage?: number;
  workspace?: string;
  layout?: CanvasLayout["layout"];
  placement?: string;
  size?: string;
  text?: string;
  arrangement?: string;
  areas?: Record<string, string>;
};
const counts = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [
    String(i),
    `${i} distinct targets`,
  ]).concat([["too_many", "More than eight targets"]]),
);
const windowActions = new Set([
  "move_window",
  "resize_window",
  "focus_window",
  "close_window",
]);
export function parameterQuestions(
  action: InterfaceAction,
  request: string,
  ctx: CommandContext,
): Record<string, ChoiceQuestion> {
  const questions: Record<string, ChoiceQuestion> = {};
  if (action === "open_settings")
    questions.section = question(
      "Which settings page does the user want to view? Opening settings never changes a preference.",
      { default: "General settings, no specific section", ...commandSettings },
    );
  if (
    action === "new_dm" ||
    action === "open_windows" ||
    action === "create_workspace"
  ) {
    const people = action === "new_dm";
    const candidates = people
      ? ctx.people.map((p) => ({
          id: p.pubkey,
          title: recipientDescription(p),
        }))
      : searchWindowCatalog(ctx.catalog, request).map((v) => ({
          id: v.id,
          title: `${v.title} (${v.kind}): ${v.description} Aliases: ${v.aliases.join(", ")}`,
        }));
    const criteria = Object.fromEntries(
      candidates.slice(0, 80).map((c) => [c.id, c.title.slice(0, 140)]),
    );
    if (action === "create_workspace")
      criteria[DRAFT_WINDOW] =
        "ONE new unsent message draft to the named people together. Use for 'message Matt and Jared' or 'a DM with Matt and Jared'. Recipients are resolved separately. Bare person lists without a message/chat verb may use existing DMs.";
    criteria.none = "No target at this position";
    criteria.unavailable = "The requested target has no reasonable match here";
    questions.count = question(
      `Count distinct ${people ? "people to address in the DM draft, ignoring widgets, projects, layout instructions and workspace names" : "content windows INSIDE the workspace, NOT the number of workspaces or operations. Each app/widget/channel is a separate window regardless of its placement. Music in the left half and weather in the right half is TWO windows. A DM draft addressed to several people counts as ONE window; that draft plus weather is TWO"}. Count unavailable targets too. Plural app names are ONE window: projects, messages, agents, repositories, issues and reviews each identify one app view, not a count of records. 'Projects on the left' is exactly ONE Projects window; position does not add another target. Do not count layout instructions or workspace names. A blank ${people ? "new message" : "workspace"} has zero.`,
      Object.fromEntries(
        Object.keys(counts).map((id) => [
          id,
          id === "too_many"
            ? "More than eight requested targets"
            : `Exactly ${id} distinct ${people ? "DM recipients" : "content windows (apps, widgets or conversations)"} requested`,
        ]),
      ),
    );
    for (let i = 0; i < 8; i++)
      questions[`target_${i + 1}`] = question(
        `Choose distinct requested ${people ? "recipient" : "window"} number ${i + 1} in mention order. ${people ? "Select people individually, never an existing group. Match short first names to usernames even without word separators. For an abbreviated name, prefer an existing DM contact and especially an open or recently active DM over a directory stranger with the same first name. Confirmed names are user-provided aliases and authoritative matches; never override an explicitly different full name or handle." : "A person by themselves means their one-to-one DM; music/weather means the widget unless explicitly called a channel. Count a group chat as one window."} Match prefixes, typos and phonetic speech errors when one candidate is clearly best; do not guess between equally plausible people. none only if no target was requested at this position, unavailable if no candidate matches.`,
        criteria,
      );
    if (!people)
      questions.layout = question(
        "Choose the explicitly requested overall arrangement. If particular windows are assigned named halves, thirds, quarters or corners, choose custom even if their regions resemble columns or rows. Otherwise choose auto when no overall preset was requested.",
        layoutChoices,
      );
  }
  if (windowActions.has(action)) {
    if (!canvasContentIds(ctx.active.canvas).length)
      throw new Error("There are no windows in this workspace yet.");
    const bulk = action === "move_window" || action === "resize_window";
    questions.window = question(
      "Select the named window or EXACT group receiving the same movement/resize. 'All windows', 'every window', and unqualified plural 'windows' mean all, never the focused window. 'Both' means all only when exactly two movable parent windows exist, otherwise use an explicitly named pair or unavailable. A pair of names selects that pair, preserving every unmentioned window. Pronouns it/that/them/those and follow-ups like 'move them more' use the recent command reference when available. 'Them' requires the complete previous group, never just focus. If no valid recent reference exists, ask rather than guess. Focus applies to explicit 'this window'. Match names despite typos. An explicit group always overrides focus. Home's summary is anchored and excluded from groups.",
      windowTargetOptions(ctx, bulk).choices,
    );
  }
  if (
    [
      "switch_workspace",
      "rename_workspace",
      "close_workspace",
      ...workspaceManagementActions,
    ].includes(action)
  ) {
    const currentIndex = ctx.workspaces.findIndex(
      (item) => item.id === ctx.active.id,
    );
    const total = ctx.workspaces.length;
    const nextIndex = (currentIndex + 1) % total;
    const previousIndex = (currentIndex - 1 + total) % total;
    questions.workspace = question(
      "Which existing workspace is targeted? This/current workspace means the current one. For icon changes, duplication, reordering, clearing or closing with no source name, choose current. For close_other_workspaces choose the ONE workspace to KEEP. A new copy/rename name is not the source. Reordering selects the workspace being moved, not its reference neighbor. For next/previous navigation choose the existing workspace labeled next/previous in dock order.",
      {
        ...Object.fromEntries(
          ctx.workspaces.map((workspace, index) => {
            const labels = [`dock position ${index + 1}`];
            if (index === currentIndex) labels.push("current");
            if (action === "switch_workspace") {
              if (index === nextIndex) labels.push("next workspace");
              if (index === previousIndex) labels.push("previous workspace");
            }
            return [workspace.id, `${workspace.name} (${labels.join(", ")})`];
          }),
        ),
        unavailable: "No matching workspace",
      },
    );
  }
  if (action === "set_workspace_icon")
    questions.icon = question(
      "Choose the icon explicitly requested, including synonyms: a message/chat/conversation bubble is messages, a folder is folders, a night icon is moon. If the user explicitly asks you to choose a fitting icon, use the TARGET workspace's name and contents from context. Only change the icon, never the name or content.",
      {
        ...workspaceIconChoices,
        unavailable: "No reasonable icon matches the requested symbol",
      },
    );
  if (action === "reorder_workspace") {
    questions.position = question(
      "Where should the targeted workspace go in the vertical dock? Up/left one position means previous, down/right one means next. Top/first and bottom/last are absolute positions. Before/after name another workspace.",
      workspacePositionChoices,
    );
    questions.reference_workspace = question(
      "For before/after, which OTHER workspace is the reference? Otherwise choose none. Never confuse the workspace being moved with this neighbor.",
      {
        none: "No named neighbor; first/last/up/down",
        ...Object.fromEntries(ctx.workspaces.map((w) => [w.id, w.name])),
        unavailable: "No matching neighbor",
      },
    );
  }
  if (action === "arrange_windows")
    questions.layout = question(
      "Choose the overall arrangement. Explicit assignments of particular windows to named halves/thirds/quarters/corners are custom, even if they happen to resemble columns or rows. Use columns/rows/grid only for a general preset without per-window region assignments.",
      layoutChoices,
    );
  if (action === "move_window")
    questions.placement = question(
      `Choose the requested movement. Bare move left/right/up/down means a relative nudge (nudge_left/right/top/bottom), keeping size and group spacing. Explicit edge/corner/center means absolute placement; half/third/quarter fills that area. 'More', 'further', 'again' without a new direction repeats the previous movement direction as a nudge. Previous successful reference: ${JSON.stringify(ctx.recent ?? null)}. If there is no prior direction and none was supplied, choose unavailable. An explicitly new direction overrides history.`,
      {
        ...areaChoices,
        ...nudgeChoices,
        unavailable: "Another placement or multiple movements",
      },
    );
  if (action === "resize_window") {
    questions.size = question(
      "Which size adjustment was requested? 'X% smaller' shrinks by X%; 'to X%' scales to X% of the current dimensions. Preserve directional intent (wider/narrower affects width only; taller/shorter height only). Half/double apply to current dimensions, not canvas size.",
      {
        ...sizeChoices,
        unavailable: "Another size",
      },
    );
    const amounts = percentageChoices(request);
    if (amounts)
      questions.percentage = question(
        "Choose the exact numeric percentage for this resize, retaining it even when a default size choice mentions 25%. For '25% smaller' choose 25, for 'to 75%' choose 75. Different percentages for different windows are unavailable.",
        amounts,
      );
  }
  if (
    ["create_workspace", "open_windows", "arrange_windows"].includes(action)
  ) {
    const targets =
      action === "arrange_windows"
        ? canvasContentIds(ctx.active.canvas)
        : Array.from(
            { length: 8 },
            (_, i) =>
              `requested window number ${i + 1} (same as target_${i + 1})`,
          );
    targets.forEach((id, i) => {
      const title =
        action === "arrange_windows"
          ? (canvasWindowView(id, ctx.catalog, ctx.active.canvas.routes?.[id])
              ?.title ?? ctx.active.name)
          : id;
      questions[`area_${i + 1}`] = question(
        `Extract the position assigned to ONLY ${title}. The area is the phrase associated with THIS window, not another window. Explicit half/third/quarter/corner assignments take priority over a general layout. For example, in 'chat left half and projects bottom third', chat gets left_half and projects gets bottom_third. A bare 'grid' or 'split screen' WITHOUT named positions gives none. Unused target slots give none.`,
        {
          none: `The request assigns NO specific position to ${title}`,
          ...areaChoices,
        },
      );
    });
  }
  if (action === "create_workspace")
    questions.scope = question(
      "This input describes what a NEW WORKSPACE is for. Interpret purpose statements as windows: 'message Matt and Jared and check the weather' means an UNSENT DM composer plus the weather widget, and is create. The verb 'message' alone never means sending. Choose unsupported only for explicit message body delivery (e.g. 'send Matt a message saying hello'), deleting/editing messages, changing permissions, or unrelated operations. Bare names and app/widget lists are valid workspace descriptions.",
      {
        create:
          "Supported workspace contents, including messaging named people via an unsent composer, checking weather, or viewing projects",
        unsupported:
          "Explicitly delivers a supplied message body, deletes/edits data, changes permissions, or asks for unrelated operations",
      },
    );
  if (
    [
      "rename_workspace",
      "create_workspace",
      "duplicate_workspace",
      "search_messages",
    ].includes(action)
  ) {
    questions.text = question(
      `Choose the exact ${action === "search_messages" ? "search query" : "explicitly requested NEW workspace name (after named/called/as)"} from these verbatim transcript spans. Do not include command verbs or unrelated instructions. Choose 0 when no explicit value is supplied.`,
      transcriptPhrases(request),
    );
  }
  return questions;
}
/** Resolve only the parameters this action uses; unused speculative slots cannot veto it. */
export function decodePlan(
  action: InterfaceAction,
  specs: Record<string, ChoiceQuestion>,
  answers: Decisions,
  ctx?: CommandContext,
): InterfacePlan {
  const result: InterfacePlan = { action };
  const pick = (id: string) => {
    const choice = selectDecision(answers, id, specs[id]);
    if (choice === "unavailable" || choice === "too_many")
      throw new Error(
        "I couldn't match all requested targets. Use a more specific name or fewer targets.",
      );
    return choice;
  };
  if (specs.scope && pick("scope") !== "create")
    throw new Error(
      "Describe the windows for your new workspace. Messages open as unsent drafts.",
    );
  if (specs.count) {
    let count: number;
    try {
      count = Number(pick("count"));
    } catch (cause) {
      const answer = answers.count;
      // Redundant count uncertainty cannot veto an independently unanimous target list.
      // Invalid answers, gaps, ambiguous targets and contradictory counts still fail.
      if (
        !answer ||
        !/^[0-8]$/.test(answer.choice) ||
        !Number.isFinite(answer.probability) ||
        answer.probability < 0 ||
        answer.probability > 1 ||
        !Number.isFinite(answer.margin) ||
        answer.margin < 0 ||
        answer.margin > answer.probability ||
        (answer.probability >= 0.5 && answer.margin >= 0.15)
      )
        throw cause;
      const slots = Array.from({ length: 8 }, (_, i) =>
        pick(`target_${i + 1}`),
      );
      count = slots.filter((id) => id !== "none").length;
      if (
        !count ||
        count !== Number(answer.choice) ||
        slots.slice(0, count).includes("none") ||
        slots.slice(count).some((id) => id !== "none")
      )
        throw cause;
    }
    if (!Number.isInteger(count) || count > 8)
      throw new Error(
        "Request up to eight targets at a time; you can keep adding windows afterward.",
      );
    const ids = Array.from({ length: count }, (_, i) =>
      pick(`target_${i + 1}`),
    );
    if (ids.includes("none") || new Set(ids).size !== ids.length)
      throw new Error(
        "I couldn't resolve every distinct target. Please rephrase.",
      );
    if (action === "new_dm") result.recipients = ids;
    else result.windowIds = ids;
    if (action === "open_windows" && !count)
      throw new Error("Which windows would you like to open?");
  }
  if (specs.window) {
    const target = pick("window");
    const group = ctx
      ? windowTargetOptions(
          ctx,
          action === "move_window" || action === "resize_window",
        ).groups[target]
      : undefined;
    if (group) {
      if (group.length === 1) result.target = group[0];
      else result.targets = group;
    } else if (
      target === "all" ||
      target === "recent" ||
      target.startsWith("group:")
    )
      throw new Error("Those windows are no longer available.");
    else result.target = target;
  }
  if (specs.section) {
    const section = pick("section");
    if (section !== "default") result.section = section;
  }
  if (specs.workspace) result.workspace = pick("workspace");
  if (specs.icon) result.icon = pick("icon") as WorkspaceIconName;
  if (specs.position) {
    result.workspacePosition = pick(
      "position",
    ) as InterfacePlan["workspacePosition"];
    if (
      result.workspacePosition === "before" ||
      result.workspacePosition === "after"
    ) {
      const reference = pick("reference_workspace");
      if (reference === "none" || reference === result.workspace)
        throw new Error("Choose another workspace as the neighbor.");
      result.referenceWorkspace = reference;
    }
  }
  if (specs.layout) {
    const layout = pick("layout");
    if (layout !== "auto") result.arrangement = layout;
    if (action === "arrange_windows" && layout === "auto")
      throw new Error("Choose focus, columns, grid or freeform.");
    if (layout !== "auto" || action === "create_workspace")
      result.layout = (
        layout === "auto"
          ? (result.windowIds?.length ?? 0) > 2
            ? "grid"
            : "columns"
          : layout === "rows" || layout === "custom"
            ? "freeform"
            : layout
      ) as CanvasLayout["layout"];
  }
  const targets =
    action === "arrange_windows"
      ? ctx
        ? canvasContentIds(ctx.active.canvas)
        : []
      : (result.windowIds ?? []);
  targets.forEach((id, i) => {
    if (!specs[`area_${i + 1}`]) return;
    const area = pick(`area_${i + 1}`);
    if (area !== "none") {
      result.areas ??= {};
      result.areas[id] = area;
    }
  });
  if (
    result.arrangement === "custom" &&
    !Object.keys(result.areas ?? {}).length
  )
    throw new Error("Which windows go in which screen areas?");
  if (specs.placement) result.placement = pick("placement");
  if (specs.size) result.size = pick("size");
  if (specs.percentage) {
    result.percentage = Number(pick("percentage"));
    if (
      ![
        "bigger",
        "smaller",
        "wider",
        "narrower",
        "taller",
        "shorter",
        "scale",
      ].includes(result.size ?? "")
    )
      throw new Error(
        "Use the percentage with smaller, bigger, wider, taller, or ‘resize to’.",
      );
  }
  if (result.size === "scale" && result.percentage === undefined)
    throw new Error("What percentage should the window be resized to?");
  if (specs.text) {
    const id = pick("text");
    if (id !== "0") result.text = specs.text.criteria[id];
    if (
      !result.text &&
      action !== "create_workspace" &&
      action !== "duplicate_workspace"
    )
      throw new Error("Include the new name or search text in your command.");
    if (action !== "search_messages" && (result.text?.length ?? 0) > 48)
      throw new Error("Workspace names can have up to 48 characters.");
  }
  return result;
}
