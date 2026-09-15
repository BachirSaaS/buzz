import { BLOCKUI_FONT_SIZES } from "@/shared/blockui/typography";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClassNames = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        ...BLOCKUI_FONT_SIZES.map((name) => `text-blockui-${name}`),
        {
          text: ["message", "message-timestamp", "2xs", "3xs"],
        },
      ],
      rounded: [
        "rounded-squircle",
        {
          rounded: [
            "blockui-xs",
            "blockui-sm",
            "blockui-12",
            "blockui-md",
            "blockui-lg",
            "blockui-32",
            "blockui-xl",
            "blockui-pill",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
