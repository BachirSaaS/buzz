// Block UI toast presentation, with Buzz's local appearance provider.
import { Toaster as Sonner } from "sonner";
import { CircleCheck, Info, TriangleAlert, OctagonX } from "lucide-react";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { Spinner } from "@/shared/ui/spinner";
type ToasterProps = React.ComponentProps<typeof Sonner>;
export function Toaster(props: ToasterProps) {
  const { isDark } = useTheme();
  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="size-4" />,
        loading: <Spinner className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--blockui-radius-md)",
          "--font-family": "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          actionButton: "rounded-full! bg-primary! text-primary-foreground!",
          cancelButton:
            "rounded-full! bg-secondary! text-secondary-foreground!",
        },
      }}
      {...props}
    />
  );
}
