import { useRef } from "react";
import { CornerDownLeft } from "@/components/app-icons";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { QuitConfirmChoice, QuitKeepRunningMode } from "../../shared/shortcuts";
import { useRestoreFocusOnClose } from "../hooks/useRestoreFocusOnClose";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	settingsDialogContentClass,
	settingsDialogFooterClass,
} from "./ui/dialog";

const BODY_KEY = {
	none: "quitConfirm.body",
	background: "quitConfirm.bodyBackground",
	detach: "quitConfirm.bodyDetach",
} as const;

// Shown when quitting: ⌘Q or the app menu on macOS, the menu bar icon's Quit,
// and closing the window on Windows/Linux. Same frame and tokens as
// ConfirmDialog, but the footer sits under a hairline and the keyboard actions
// name their key: Esc cancels, Return takes the primary action, which starts
// focused. Where the platform can keep agents running (macOS menu bar icon, or
// quitting while leaving agents for the next launch on Windows/Linux), that is
// the primary action and Quit completely sits beside it; the body says what
// each choice does to running agents and to Orchestrator's supervision.
export function QuitConfirmDialog({
	open,
	keepRunning = null,
	onResolve,
}: {
	open: boolean;
	keepRunning?: QuitKeepRunningMode | null;
	onResolve: (choice: QuitConfirmChoice) => void;
}) {
	const { t } = useTranslation();
	const restoreFocusOnClose = useRestoreFocusOnClose(open);
	const primaryRef = useRef<HTMLButtonElement>(null);
	const offersKeepRunning = keepRunning !== null;

	return (
		<Dialog open={open} onOpenChange={(next) => { if (!next) onResolve("cancel"); }}>
			<DialogContent
				showCloseButton={false}
				className={cn(
					settingsDialogContentClass,
					offersKeepRunning ? "w-[min(500px,calc(100vw-24px))]" : "w-[min(440px,calc(100vw-24px))]",
				)}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					primaryRef.current?.focus();
				}}
				onCloseAutoFocus={restoreFocusOnClose}
			>
				<div className="flex flex-col gap-1 p-5">
					<DialogTitle className="settings-dialog-title text-base">{t("quitConfirm.title")}</DialogTitle>
					<DialogDescription className="text-control leading-5 text-settings-muted">
						{t(BODY_KEY[keepRunning ?? "none"])}
					</DialogDescription>
				</div>

				<div className={cn(settingsDialogFooterClass, "gap-1.5 px-3 py-2.5")}>
					<DialogClose asChild>
						<Button type="button" variant="ghost" aria-keyshortcuts="Escape" className="gap-2">
							{t("confirm.cancel")}
							<kbd aria-hidden="true" className="font-sans text-caption text-muted-foreground">Esc</kbd>
						</Button>
					</DialogClose>
					{offersKeepRunning ? (
						<Button type="button" variant="secondary" onClick={() => onResolve("quit")}>
							{t("quitConfirm.quitCompletely")}
						</Button>
					) : null}
					<Button
						ref={primaryRef}
						type="button"
						variant="primary"
						aria-keyshortcuts="Enter"
						onClick={() => onResolve(offersKeepRunning ? "keep-running" : "quit")}
					>
						{t(offersKeepRunning ? "quitConfirm.keepRunning" : "quitConfirm.quit")}
						<CornerDownLeft aria-hidden="true" className="size-3.5 opacity-80" />
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
