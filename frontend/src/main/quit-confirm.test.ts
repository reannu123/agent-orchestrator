import { describe, expect, it, vi } from "vitest";
import { createQuitConfirmController } from "./quit-confirm";
import type { QuitConfirmChoice } from "../shared/shortcuts";

type Options = Parameters<typeof createQuitConfirmController>[0];

function setup(overrides: Partial<Options> = {}) {
	const options: Options = {
		platform: "darwin",
		isEnabled: () => true,
		isBypassed: () => false,
		canConfirm: () => true,
		canConfirmWindowClose: () => true,
		hasTray: () => false,
		requestConfirm: vi.fn(),
		quit: vi.fn(),
		quitCompletely: vi.fn(),
		quitKeepingAgents: vi.fn(),
		...overrides,
	};
	const controller = createQuitConfirmController(options);
	const exits = () => ({
		quit: vi.mocked(options.quit).mock.calls.length,
		quitCompletely: vi.mocked(options.quitCompletely).mock.calls.length,
		quitKeepingAgents: vi.mocked(options.quitKeepingAgents).mock.calls.length,
	});
	return { controller, options, requestConfirm: vi.mocked(options.requestConfirm), exits };
}

const none = { quit: 0, quitCompletely: 0, quitKeepingAgents: 0 };

describe("macOS app menu Quit", () => {
	it.each([true, false])("asks before quitting (fromShortcut=%s) and quits completely once confirmed", (fromShortcut) => {
		const { controller, requestConfirm, exits } = setup();
		controller.menuQuit(fromShortcut);
		expect(requestConfirm).toHaveBeenCalledExactlyOnceWith({ keepRunning: null });
		expect(exits()).toEqual(none);
		controller.resolve("quit");
		expect(exits()).toEqual({ ...none, quitCompletely: 1 });
	});

	it("offers to keep running in the menu bar when the tray is up", () => {
		const { controller, requestConfirm, exits } = setup({ hasTray: () => true });
		controller.menuQuit(true);
		expect(requestConfirm).toHaveBeenCalledExactlyOnceWith({ keepRunning: "background" });
		controller.resolve("keep-running");
		// The ordinary quit: with the tray it only closes the window.
		expect(exits()).toEqual({ ...none, quit: 1 });
	});

	it("quits completely with the tray up when asked to", () => {
		const { controller, exits } = setup({ hasTray: () => true });
		controller.menuQuit(true);
		controller.resolve("quit");
		expect(exits()).toEqual({ ...none, quitCompletely: 1 });
	});

	it("does nothing on Cancel and asks again next time", () => {
		const { controller, requestConfirm, exits } = setup();
		controller.menuQuit(true);
		controller.resolve("cancel");
		expect(exits()).toEqual(none);
		controller.menuQuit(false);
		expect(requestConfirm).toHaveBeenCalledTimes(2);
	});

	it("quits on a second ⌘Q while the dialog is showing", () => {
		const { controller, requestConfirm, exits } = setup({ hasTray: () => true });
		controller.menuQuit(true);
		controller.menuQuit(true);
		expect(requestConfirm).toHaveBeenCalledOnce();
		expect(exits()).toEqual({ ...none, quit: 1 });
		// The dialog's late answer is ignored: the quit already happened.
		controller.resolve("quit");
		expect(exits()).toEqual({ ...none, quit: 1 });
	});

	it("re-sends the same request on a mouse Quit while the dialog is showing", () => {
		const { controller, requestConfirm, exits } = setup();
		controller.menuQuit(true);
		controller.menuQuit(false);
		expect(requestConfirm).toHaveBeenCalledTimes(2);
		expect(requestConfirm.mock.calls[1]).toEqual(requestConfirm.mock.calls[0]);
		expect(exits()).toEqual(none);
	});

	it("quits at once when there is no visible shell to ask in", () => {
		const { controller, requestConfirm, exits } = setup({ canConfirm: () => false });
		controller.menuQuit(true);
		expect(requestConfirm).not.toHaveBeenCalled();
		expect(exits()).toEqual({ ...none, quit: 1 });
	});

	it.each([true, false])("quits at once with the setting off (fromShortcut=%s)", (fromShortcut) => {
		const { controller, requestConfirm, exits } = setup({ isEnabled: () => false, hasTray: () => true });
		controller.menuQuit(fromShortcut);
		expect(requestConfirm).not.toHaveBeenCalled();
		expect(exits()).toEqual({ ...none, quit: 1 });
	});

	it("does not ask during an update restart, OS shutdown or a quit under way", () => {
		const { controller, requestConfirm, exits } = setup({ isBypassed: () => true });
		controller.menuQuit(true);
		expect(requestConfirm).not.toHaveBeenCalled();
		expect(exits()).toEqual({ ...none, quit: 1 });
	});

	it("asks again after the shell reloaded", () => {
		const { controller, requestConfirm, exits } = setup();
		controller.menuQuit(true);
		controller.reset();
		expect(controller.isPending()).toBe(false);
		controller.resolve("quit");
		expect(exits()).toEqual(none);
		controller.menuQuit(true);
		expect(requestConfirm).toHaveBeenCalledTimes(2);
	});
});

describe("macOS menu bar icon Quit", () => {
	it("asks, then quits completely or hides as chosen", () => {
		const { controller, requestConfirm, exits } = setup({ hasTray: () => true });
		controller.trayQuit();
		expect(requestConfirm).toHaveBeenCalledExactlyOnceWith({ keepRunning: "background" });
		controller.resolve("keep-running");
		expect(exits()).toEqual({ ...none, quit: 1 });
		controller.trayQuit();
		controller.resolve("quit");
		expect(exits()).toEqual({ quit: 1, quitCompletely: 1, quitKeepingAgents: 0 });
	});

	it("does not stack dialogs on repeated clicks", () => {
		const { controller, requestConfirm, exits } = setup({ hasTray: () => true });
		controller.trayQuit();
		controller.trayQuit();
		expect(requestConfirm).toHaveBeenCalledTimes(2);
		expect(controller.isPending()).toBe(true);
		expect(exits()).toEqual(none);
	});

	it.each([
		["the setting is off", { isEnabled: () => false }],
		["the window is hidden", { canConfirm: () => false }],
		["a shutdown bypasses it", { isBypassed: () => true }],
	])("quits completely at once when %s", (_label, overrides) => {
		const { controller, requestConfirm, exits } = setup({ hasTray: () => true, ...overrides });
		controller.trayQuit();
		expect(requestConfirm).not.toHaveBeenCalled();
		expect(exits()).toEqual({ ...none, quitCompletely: 1 });
	});
});

describe.each<NodeJS.Platform>(["linux", "win32"])("closing the window on %s", (platform) => {
	it("prevents the close and asks, offering to keep agents running", () => {
		const { controller, requestConfirm, exits } = setup({ platform });
		expect(controller.windowClose()).toBe(true);
		expect(requestConfirm).toHaveBeenCalledExactlyOnceWith({ keepRunning: "detach" });
		expect(exits()).toEqual(none);
	});

	it.each<[QuitConfirmChoice, ReturnType<ReturnType<typeof setup>["exits"]>]>([
		["cancel", none],
		["quit", { ...none, quitCompletely: 1 }],
		["keep-running", { ...none, quitKeepingAgents: 1 }],
	])("carries out %s", (choice, expected) => {
		const { controller, exits } = setup({ platform });
		controller.windowClose();
		controller.resolve(choice);
		expect(exits()).toEqual(expected);
		expect(controller.isPending()).toBe(false);
	});

	it("re-sends on repeated close presses instead of stacking or quitting", () => {
		const { controller, requestConfirm, exits } = setup({ platform });
		expect(controller.windowClose()).toBe(true);
		expect(controller.windowClose()).toBe(true);
		expect(controller.windowClose()).toBe(true);
		expect(requestConfirm).toHaveBeenCalledTimes(3);
		expect(exits()).toEqual(none);
		controller.resolve("quit");
		controller.resolve("quit");
		expect(exits()).toEqual({ ...none, quitCompletely: 1 });
	});

	it("lets the close through unchanged with the setting off", () => {
		const { controller, requestConfirm, exits } = setup({ platform, isEnabled: () => false });
		expect(controller.windowClose()).toBe(false);
		expect(requestConfirm).not.toHaveBeenCalled();
		expect(exits()).toEqual(none);
	});

	it("lets the close through during an update restart, OS shutdown or quit under way", () => {
		const { controller, requestConfirm } = setup({ platform, isBypassed: () => true });
		expect(controller.windowClose()).toBe(false);
		expect(requestConfirm).not.toHaveBeenCalled();
	});

	it("keeps agents running when no shell can show the dialog", () => {
		const { controller, requestConfirm, exits } = setup({ platform, canConfirmWindowClose: () => false });
		expect(controller.windowClose()).toBe(true);
		expect(requestConfirm).not.toHaveBeenCalled();
		expect(exits()).toEqual({ ...none, quitKeepingAgents: 1 });
	});

	it("ignores a keep-running answer the dialog never offered", () => {
		const { controller, exits } = setup({ platform: "darwin" });
		controller.menuQuit(true);
		controller.resolve("keep-running");
		expect(exits()).toEqual(none);
		expect(controller.isPending()).toBe(false);
	});
});

describe("closing the window on macOS", () => {
	it.each([true, false])("never asks, since it does not quit (tray=%s)", (tray) => {
		const { controller, requestConfirm } = setup({ hasTray: () => tray });
		expect(controller.windowClose()).toBe(false);
		expect(requestConfirm).not.toHaveBeenCalled();
	});
});
