"use client";
// Header, menu and footer: on every route, signed in or not.
import * as Menu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useTheme } from "next-themes";
import type { CrisisLine } from "@/core/types";
import { NeedHelpSheet } from "./crisis";

export const REPO_URL = "https://github.com/lokeshrana9999/samatva-support";

export type MenuActions = {
  traceOn: boolean;
  onToggleTrace: () => void;
  onDelete: () => void;
  onStartOver: () => void;
  onSignOut: () => void;
};

const itemClass =
  "flex min-h-11 cursor-pointer items-center rounded-md px-3 text-[15px] outline-none data-[highlighted]:bg-user-bubble";

// Pinned to the top on every page, so "Need help now?" is always one tap away.
// `children` sits under the header row in the same pinned block (the chat's
// stage stepper).
export function Header({
  lines,
  menu,
  children,
}: {
  lines: CrisisLine[];
  menu?: MenuActions;
  children?: React.ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
      <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="font-serif text-[20px] font-semibold">
          samatva support
        </Link>
        <div className="flex items-center gap-2">
          <NeedHelpSheet lines={lines} />
          {menu && (
            <Menu.Root>
              <Menu.Trigger className="min-h-11 min-w-11 rounded-lg border border-input-border px-3 text-[14px] font-medium">
                Menu
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 w-64 rounded-xl border border-line bg-surface p-1 text-ink"
                >
                  <Menu.CheckboxItem className={itemClass} checked={menu.traceOn} onCheckedChange={menu.onToggleTrace}>
                    <span aria-hidden className="mr-2 inline-block w-4">
                      {menu.traceOn ? "✓" : ""}
                    </span>
                    Under the hood
                  </Menu.CheckboxItem>
                  <Menu.Separator className="my-1 h-px bg-line" />
                  <Menu.Label className="px-3 pt-1 text-[13px] text-muted">Theme</Menu.Label>
                  <Menu.RadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                    {["system", "light", "dark"].map((t) => (
                      <Menu.RadioItem key={t} value={t} className={itemClass}>
                        <span aria-hidden className="mr-2 inline-block w-4">
                          {theme === t ? "•" : ""}
                        </span>
                        {t[0].toUpperCase() + t.slice(1)}
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                  <Menu.Separator className="my-1 h-px bg-line" />
                  <Menu.Item className={itemClass} onSelect={menu.onDelete}>
                    Delete my conversation
                  </Menu.Item>
                  <Menu.Item className={itemClass} onSelect={menu.onStartOver}>
                    Start over
                  </Menu.Item>
                  <Menu.Item className={itemClass} onSelect={menu.onSignOut}>
                    Sign out
                  </Menu.Item>
                  <Menu.Separator className="my-1 h-px bg-line" />
                  <Menu.Item className={itemClass} asChild>
                    <Link href="/evals#about">About this demo</Link>
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>
      </div>
      {children && <div className="mx-auto max-w-[680px] px-4 pb-3 sm:px-6">{children}</div>}
    </header>
  );
}

export function DemoFooter() {
  return (
    <footer className="mx-auto max-w-[680px] px-4 py-6 text-[13px] leading-[18px] text-muted sm:px-6">
      Independent demo by Lokesh, not affiliated with Amaha. ·{" "}
      <Link className="underline" href="/evals">
        Evals
      </Link>{" "}
      ·{" "}
      <a className="underline" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        GitHub
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </footer>
  );
}
