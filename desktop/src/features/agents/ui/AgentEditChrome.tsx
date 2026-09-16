import { Button } from "@/shared/ui/button";
import { AgentCreationPreview } from "./AgentCreationPreview";

/** Shared dialog chrome kept outside the instance configuration state machine. */
export function AgentEditFooter({
  isSaving,
  uploadPending,
  canSubmit,
  onCancel,
  onSave,
}: {
  isSaving: boolean;
  uploadPending: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-end gap-2">
      <Button
        disabled={isSaving || uploadPending}
        onClick={onCancel}
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
      <Button
        data-testid="edit-agent-dialog-submit"
        disabled={!canSubmit}
        onClick={onSave}
        type="button"
      >
        {isSaving ? "Saving..." : "Save changes"}
      </Button>
    </div>
  );
}

export function AgentEditAvatar({
  label,
  avatarUrl,
  isSaving,
  onSelectAvatar,
  onUploadPendingChange,
  onClose,
  onEditLinkedPersona,
}: {
  label: string;
  avatarUrl: string | null;
  isSaving: boolean;
  onSelectAvatar: (url: string) => void;
  onUploadPendingChange: (pending: boolean) => void;
  onClose: () => void;
  onEditLinkedPersona?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <AgentCreationPreview
        avatarUrl={avatarUrl}
        hideEditControl
        label={label}
        onClearAvatar={() => onSelectAvatar("")}
        onUploadPendingChange={onUploadPendingChange}
        onSelectAvatar={onSelectAvatar}
      />
      {onEditLinkedPersona ? (
        <Button
          className="w-full"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onEditLinkedPersona();
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Edit avatar
        </Button>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Avatar is shared identity
        </p>
      )}
    </div>
  );
}
