import type { CanvasView } from "./canvasLayout";

/** Resolve content independently of the stable ID that owns a window's geometry. */
export function canvasWindowView(
  id: string,
  views: CanvasView[],
  route?: Record<string, string>,
): CanvasView | undefined {
  if (!route?.feed) return views.find((view) => view.id === id);
  if (route.windowView === "conversation" && route.conversation) {
    const conversation = views.find(
      (view) =>
        (view.kind === "channel" || view.kind === "dm") &&
        view.target === route.conversation,
    );
    return {
      id,
      kind: conversation?.kind ?? "channel",
      title: conversation?.title ?? "Conversation",
      target: route.conversation,
    };
  }
  const title = {
    conversation: "Messages",
    search: "Messages",
    projects: "Projects",
    agents: "Agents",
    workflows: "Apps",
  }[route.feed];
  return title
    ? { id, kind: "app", title, target: route.feed }
    : views.find((view) => view.id === id);
}
