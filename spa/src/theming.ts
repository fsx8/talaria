/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The theme registry: every theme the pickers offer — the two Talaria
 * identities (registered in style.css via `@plugin "daisyui/theme"`) plus
 * daisyUI's built-ins (enabled with `themes: all`) — grouped for display.
 * Each entry carries its color-scheme so the OS-preference default and the
 * picker's sun/moon markers work for every theme alike.
 */

export interface ThemeEntry {
  /** The `data-theme` value. */
  id: string;
  name: string;
  scheme: "light" | "dark";
}

export interface ThemeGroup {
  label: string;
  entries: ThemeEntry[];
}

export const TALARIA_THEMES: ThemeEntry[] = [
  { id: "talaria-light", name: "Talaria Day", scheme: "light" },
  { id: "talaria-dark", name: "Talaria Night", scheme: "dark" },
];

const theme = (id: string, name: string, scheme: "light" | "dark"): ThemeEntry => ({ id, name, scheme });

export const THEME_GROUPS: ThemeGroup[] = [
  { label: "Talaria", entries: TALARIA_THEMES },
  {
    label: "Light",
    entries: [
      theme("light", "Light", "light"),
      theme("corporate", "Corporate", "light"),
      theme("caramellatte", "Caramel Latte", "light"),
      theme("lofi", "Lofi", "light"),
      theme("wireframe", "Wireframe", "light"),
      theme("nord", "Nord", "light"),
      theme("winter", "Winter", "light"),
    ],
  },
  {
    label: "Dark",
    entries: [
      theme("dark", "Dark", "dark"),
      theme("black", "Black", "dark"),
      theme("business", "Business", "dark"),
      theme("dim", "Dim", "dark"),
      theme("night", "Night", "dark"),
      theme("forest", "Forest", "dark"),
      theme("aqua", "Aqua", "dark"),
    ],
  },
  {
    label: "Colorful",
    entries: [
      theme("cupcake", "Cupcake", "light"),
      theme("bumblebee", "Bumblebee", "light"),
      theme("emerald", "Emerald", "light"),
      theme("synthwave", "Synthwave", "dark"),
      theme("retro", "Retro", "light"),
      theme("cyberpunk", "Cyberpunk", "light"),
      theme("valentine", "Valentine", "light"),
      theme("halloween", "Halloween", "dark"),
      theme("garden", "Garden", "light"),
      theme("pastel", "Pastel", "light"),
      theme("fantasy", "Fantasy", "light"),
      theme("luxury", "Luxury", "dark"),
      theme("dracula", "Dracula", "dark"),
      theme("cmyk", "CMYK", "light"),
      theme("autumn", "Autumn", "light"),
      theme("acid", "Acid", "light"),
      theme("lemonade", "Lemonade", "light"),
      theme("coffee", "Coffee", "dark"),
      theme("sunset", "Sunset", "dark"),
      theme("abyss", "Abyss", "dark"),
      theme("silk", "Silk", "light"),
    ],
  },
];

export const ALL_THEMES: ThemeEntry[] = THEME_GROUPS.flatMap((group) => group.entries);

export function themeEntry(id: string): ThemeEntry | undefined {
  return ALL_THEMES.find((entry) => entry.id === id);
}

/**
 * "system" is not a theme — it resolves through the OS preference onto the
 * Talaria identity, so an unset install lands on the brand in the right
 * color-scheme. Concrete ids pass through (validated by the caller).
 */
export function resolveThemeId(preference: string): string {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "talaria-dark" : "talaria-light";
}
