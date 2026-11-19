import { beforeEach, describe, expect, it, vi } from "vitest";

const getUiSettings = vi.fn();
const setUiSettings = vi.fn();

vi.mock("../lib/bridge", () => ({
	aoBridge: {
		uiSettings: {
			get: (...args: unknown[]) => getUiSettings(...args),
			set: (...args: unknown[]) => setUiSettings(...args),
		},
	},
}));

import { useConfirmBeforeQuitStore } from "./confirm-before-quit-store";

describe("confirm-before-quit-store", () => {
	beforeEach(() => {
		getUiSettings.mockReset();
		setUiSettings.mockReset();
		getUiSettings.mockResolvedValue({ locale: "en", confirmBeforeQuit: true });
		setUiSettings.mockImplementation(async (settings: { confirmBeforeQuit: boolean }) => settings);
		useConfirmBeforeQuitStore.setState({ enabled: true, loaded: false, saving: false, saveError: false });
	});

	it("defaults to enabled before load", () => {
		expect(useConfirmBeforeQuitStore.getState().enabled).toBe(true);
	});

	it("loads the persisted setting from the main process", async () => {
		getUiSettings.mockResolvedValue({ locale: "en", confirmBeforeQuit: false });
		await useConfirmBeforeQuitStore.getState().load();
		expect(useConfirmBeforeQuitStore.getState()).toMatchObject({ enabled: false, loaded: true });
	});

	it("persists changes", async () => {
		await useConfirmBeforeQuitStore.getState().setEnabled(false);
		expect(setUiSettings).toHaveBeenCalledWith({ confirmBeforeQuit: false });
		expect(useConfirmBeforeQuitStore.getState()).toMatchObject({ enabled: false, saving: false, saveError: false });
	});

	it("does not reload after the first successful load", async () => {
		await useConfirmBeforeQuitStore.getState().load();
		await useConfirmBeforeQuitStore.getState().load();
		expect(getUiSettings).toHaveBeenCalledTimes(1);
	});

	it("shares one persisted read across concurrent startup callers", async () => {
		let resolveGet: ((settings: { confirmBeforeQuit: boolean }) => void) | undefined;
		getUiSettings.mockReturnValue(
			new Promise<{ confirmBeforeQuit: boolean }>((resolve) => {
				resolveGet = resolve;
			}),
		);

		const first = useConfirmBeforeQuitStore.getState().load();
		const second = useConfirmBeforeQuitStore.getState().load();
		expect(getUiSettings).toHaveBeenCalledTimes(1);
		resolveGet?.({ confirmBeforeQuit: false });
		await Promise.all([first, second]);

		expect(useConfirmBeforeQuitStore.getState()).toMatchObject({ enabled: false, loaded: true });
	});

	it("does not let a late persisted read overwrite a newer user selection", async () => {
		let resolveGet: ((settings: { confirmBeforeQuit: boolean }) => void) | undefined;
		getUiSettings.mockReturnValue(
			new Promise<{ confirmBeforeQuit: boolean }>((resolve) => {
				resolveGet = resolve;
			}),
		);

		const loading = useConfirmBeforeQuitStore.getState().load();
		await useConfirmBeforeQuitStore.getState().setEnabled(false);
		resolveGet?.({ confirmBeforeQuit: true });
		await loading;

		expect(useConfirmBeforeQuitStore.getState().enabled).toBe(false);
	});

	it("keeps the default usable when persisted settings cannot be read", async () => {
		getUiSettings.mockRejectedValue(new Error("IPC unavailable"));
		await expect(useConfirmBeforeQuitStore.getState().load()).resolves.toBeUndefined();
		expect(useConfirmBeforeQuitStore.getState()).toMatchObject({ enabled: true, loaded: true });
	});

	it("keeps the current value and exposes an error when persistence fails", async () => {
		setUiSettings.mockRejectedValue(new Error("disk full"));
		await expect(useConfirmBeforeQuitStore.getState().setEnabled(false)).resolves.toBeUndefined();
		expect(useConfirmBeforeQuitStore.getState()).toMatchObject({
			enabled: true,
			saving: false,
			saveError: true,
		});
	});
});
