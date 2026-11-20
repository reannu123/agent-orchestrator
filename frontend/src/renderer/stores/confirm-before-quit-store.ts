// "Confirm before quitting" (Settings → General), persisted in ui-settings.json so
// the main process can read it on every quit path.
import { create } from "zustand";
import { aoBridge } from "../lib/bridge";

type ConfirmBeforeQuitState = {
	enabled: boolean;
	loaded: boolean;
	saving: boolean;
	saveError: boolean;
	load: () => Promise<void>;
	setEnabled: (enabled: boolean) => Promise<void>;
};

const DEFAULT_ENABLED = true;

let settingRevision = 0;
let pendingLoad: Promise<void> | undefined;

export const useConfirmBeforeQuitStore = create<ConfirmBeforeQuitState>((set, get) => ({
	enabled: DEFAULT_ENABLED,
	loaded: false,
	saving: false,
	saveError: false,
	load: async () => {
		if (get().loaded) return;
		if (pendingLoad) return pendingLoad;
		const revisionAtStart = settingRevision;
		pendingLoad = (async () => {
			let enabled = DEFAULT_ENABLED;
			try {
				const settings = await aoBridge.uiSettings.get();
				// Default on: only an explicit false turns it off.
				enabled = settings.confirmBeforeQuit !== false;
			} catch {
				// A missing bridge or unreadable setting must not prevent the UI from starting.
			}
			if (revisionAtStart === settingRevision) set({ enabled, loaded: true });
		})();
		try {
			await pendingLoad;
		} finally {
			pendingLoad = undefined;
		}
	},
	setEnabled: async (enabled) => {
		const revision = ++settingRevision;
		set({ saving: true, saveError: false });
		try {
			await aoBridge.uiSettings.set({ confirmBeforeQuit: enabled });
			if (revision === settingRevision) set({ enabled, loaded: true, saving: false });
		} catch {
			if (revision === settingRevision) set({ saving: false, saveError: true });
		}
	},
}));
