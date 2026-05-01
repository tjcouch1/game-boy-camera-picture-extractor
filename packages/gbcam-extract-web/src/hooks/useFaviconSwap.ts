import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Updates the runtime favicon link to match the resolved (light/dark) theme.
 * The static <link rel="icon"> tags in index.html handle first paint via
 * media queries; this hook overrides the favicon when the user picks a theme
 * different from their OS preference.
 */
export function useFaviconSwap() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;
    const isDark = resolvedTheme === "dark";
    const href = isDark ? "./icon-dark.svg" : "./icon.svg";
    const cacheBuster = `?v=${resolvedTheme}`;

    let link = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-runtime="true"]',
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.dataset.runtime = "true";
      document.head.appendChild(link);
    }
    link.href = `${href}${cacheBuster}`;
  }, [resolvedTheme]);
}
