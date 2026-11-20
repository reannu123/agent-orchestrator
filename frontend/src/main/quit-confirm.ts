import type { QuitConfirmChoice, QuitConfirmRequest, QuitKeepRunningMode } from "../shared/shortcuts";

// Asks before quitting when "Confirm before quitting" is on: the shell shows the
// quit dialog and reports the choice back. Covers the macOS app menu Quit (mouse
// or ⌘Q), the macOS menu bar icon's Quit, and closing the window on Windows and
// Linux, where that quits the app. A second ⌘Q while the dialog is up keeps its
// old meaning and quits; any other repeat re-sends the request to the one open
// dialog instead of stacking another. With the setting off, the menu quits at
// once, the tray quits completely and closing the window just closes it.
//
// Never asks when there is no point or no time: an update restart, an OS
// shutdown or logout, or a quit already under way (isBypassed). When closing the
// window on Windows/Linux and there is no shell able to show the dialog, the
// safe default is to quit while leaving agents running, never to stop them.
export function createQuitConfirmController(options: {
	platform: NodeJS.Platform;
	/** The persisted "Confirm before quitting" setting. */
	isEnabled(): boolean;
	/** Update restart, OS shutdown/logout, or a quit already in progress. */
	isBypassed(): boolean;
	/** macOS menu/tray: false when there is no visible shell to show the dialog in. */
	canConfirm(): boolean;
	/** Window close: the shell can show the dialog (main reveals the window first). */
	canConfirmWindowClose(): boolean;
	/** The macOS menu bar icon is up, so Quit can just close the window. */
	hasTray(): boolean;
	requestConfirm(request: QuitConfirmRequest): void;
	/** The app's ordinary quit: with the macOS tray up it only closes the window. */
	quit(): void;
	/** Quit and stop agents, even with the macOS tray up. */
	quitCompletely(): void;
	/** Quit the app but leave agents running for the next launch to adopt. */
	quitKeepingAgents(): void;
}) {
	let pending: QuitConfirmRequest | null = null;

	function keepRunningMode(): QuitKeepRunningMode | null {
		if (options.platform === "darwin") return options.hasTray() ? "background" : null;
		return "detach";
	}

	function ask(): void {
		pending = { keepRunning: keepRunningMode() };
		options.requestConfirm(pending);
	}

	function shouldAsk(): boolean {
		return options.isEnabled() && !options.isBypassed();
	}

	return {
		/** macOS app menu Quit, chosen with the mouse or by ⌘Q. */
		menuQuit(fromShortcut: boolean): void {
			if (pending) {
				if (fromShortcut) {
					pending = null;
					options.quit();
				} else {
					options.requestConfirm(pending);
				}
				return;
			}
			if (!shouldAsk() || !options.canConfirm()) {
				options.quit();
				return;
			}
			ask();
		},
		/** The macOS menu bar icon's Quit, which always meant quit completely. */
		trayQuit(): void {
			if (pending) {
				options.requestConfirm(pending);
				return;
			}
			if (!shouldAsk() || !options.canConfirm()) {
				options.quitCompletely();
				return;
			}
			ask();
		},
		/**
		 * The window is closing where that quits the app (Windows/Linux). Returns
		 * true when the close must be prevented: the dialog decides instead.
		 */
		windowClose(): boolean {
			if (options.platform === "darwin" || !shouldAsk()) return false;
			if (pending) {
				options.requestConfirm(pending);
				return true;
			}
			if (!options.canConfirmWindowClose()) {
				options.quitKeepingAgents();
				return true;
			}
			ask();
			return true;
		},
		resolve(choice: QuitConfirmChoice): void {
			const request = pending;
			if (!request) return;
			pending = null;
			if (choice === "quit") {
				options.quitCompletely();
			} else if (choice === "keep-running") {
				// Only honor what the dialog actually offered.
				if (request.keepRunning === "background") options.quit();
				else if (request.keepRunning === "detach") options.quitKeepingAgents();
			}
		},
		isPending(): boolean {
			return pending !== null;
		},
		/** The shell reloaded, so any dialog it was showing is gone. */
		reset(): void {
			pending = null;
		},
	};
}
