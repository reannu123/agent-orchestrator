import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { appI18n as i18n } from "../i18n";
import { QuitConfirmDialog } from "./QuitConfirmDialog";

afterEach(async () => {
	await act(async () => {
		await i18n.changeLanguage("en");
	});
});

describe("without a keep-running option (macOS without the menu bar icon)", () => {
	test("asks to quit with Quit focused so Return confirms", async () => {
		const onResolve = vi.fn();
		render(<QuitConfirmDialog open onResolve={onResolve} />);

		expect(screen.getByRole("dialog", { name: "Quit Orchestrator?" })).toHaveAccessibleDescription(
			"Quitting stops all running agents.",
		);
		expect(screen.queryByRole("button", { name: "Keep agents running" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Quit completely" })).not.toBeInTheDocument();
		const quit = screen.getByRole("button", { name: "Quit" });
		await waitFor(() => expect(quit).toHaveFocus());
		expect(quit).toHaveAttribute("aria-keyshortcuts", "Enter");

		fireEvent.click(quit);
		expect(onResolve).toHaveBeenCalledExactlyOnceWith("quit");
	});

	test("Cancel and Escape both dismiss without quitting", () => {
		const onResolve = vi.fn();
		render(<QuitConfirmDialog open onResolve={onResolve} />);

		const cancel = screen.getByRole("button", { name: "Cancel" });
		expect(cancel).toHaveAttribute("aria-keyshortcuts", "Escape");
		fireEvent.click(cancel);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onResolve.mock.calls).toEqual([["cancel"], ["cancel"]]);
	});
});

describe.each([
	[
		"background",
		"Keep agents running closes the window and leaves Orchestrator in the menu bar, still supervising your agents. Quit completely stops all running agents.",
	],
	[
		"detach",
		"Keep agents running closes Orchestrator and leaves your agents working. Until you reopen it, Orchestrator pauses CI and review routing, auto-resume and notifications. Quit completely stops all running agents.",
	],
] as const)("with keep-running mode %s", (mode, body) => {
	test("explains what each choice does to agents and supervision", () => {
		render(<QuitConfirmDialog open keepRunning={mode} onResolve={vi.fn()} />);
		expect(screen.getByRole("dialog", { name: "Quit Orchestrator?" })).toHaveAccessibleDescription(body);
	});

	test("makes Keep agents running the focused primary action, after Cancel and Quit completely", async () => {
		const onResolve = vi.fn();
		render(<QuitConfirmDialog open keepRunning={mode} onResolve={onResolve} />);

		const buttons = screen.getAllByRole("button");
		expect(buttons.map((button) => button.textContent)).toEqual([
			"CancelEsc",
			"Quit completely",
			"Keep agents running",
		]);
		const keep = screen.getByRole("button", { name: "Keep agents running" });
		await waitFor(() => expect(keep).toHaveFocus());
		expect(keep).toHaveAttribute("aria-keyshortcuts", "Enter");

		fireEvent.click(keep);
		fireEvent.click(screen.getByRole("button", { name: "Quit completely" }));
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onResolve.mock.calls).toEqual([["keep-running"], ["quit"], ["cancel"]]);
	});
});

test("is localized", async () => {
	await act(async () => {
		await i18n.changeLanguage("de");
	});
	render(<QuitConfirmDialog open keepRunning="detach" onResolve={vi.fn()} />);
	expect(screen.getByRole("dialog", { name: "Orchestrator beenden?" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Agenten weiterlaufen lassen" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Vollständig beenden" })).toBeInTheDocument();
});
