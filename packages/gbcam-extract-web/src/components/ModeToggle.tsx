import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Button } from "@/shadcn/components/button";
import { cn } from "@/shadcn/utils/utils";

type ThemeOption = "light" | "dark" | "system";
const CYCLE: Record<ThemeOption, ThemeOption> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const itemClass = cn(
  "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none",
  "focus:bg-accent focus:text-accent-foreground",
  "data-disabled:pointer-events-none data-disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
);

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cycleTheme = () => {
    const current = (theme as ThemeOption | undefined) ?? "system";
    setTheme(CYCLE[current] ?? "light");
  };

  const Icon = !mounted
    ? Sun
    : theme === "system"
      ? SunMoon
      : theme === "dark"
        ? Moon
        : Sun;

  return (
    <>
      <Button
        ref={buttonRef}
        variant="outline"
        size="icon"
        aria-label="Toggle theme (right-click for options)"
        title="Click to cycle theme; right-click for options"
        onClick={cycleTheme}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <Icon />
      </Button>
      <MenuPrimitive.Root open={open} onOpenChange={setOpen}>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Positioner
            className="isolate z-50 outline-none"
            align="end"
            sideOffset={4}
            anchor={buttonRef}
          >
            <MenuPrimitive.Popup
              className={cn(
                "z-50 min-w-32 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
                "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
                "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              )}
            >
              <MenuPrimitive.Item
                className={itemClass}
                onClick={() => setTheme("light")}
              >
                <Sun data-icon="inline-start" />
                Light
              </MenuPrimitive.Item>
              <MenuPrimitive.Item
                className={itemClass}
                onClick={() => setTheme("dark")}
              >
                <Moon data-icon="inline-start" />
                Dark
              </MenuPrimitive.Item>
              <MenuPrimitive.Item
                className={itemClass}
                onClick={() => setTheme("system")}
              >
                <SunMoon data-icon="inline-start" />
                System
              </MenuPrimitive.Item>
            </MenuPrimitive.Popup>
          </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Root>
    </>
  );
}
