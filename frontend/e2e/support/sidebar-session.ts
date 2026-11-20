import type { Page } from "@playwright/test";

/** Locate the session opener by its visible title, even when the accessible name includes identity details. */
export function sidebarSessionButton(page: Page, title: string) {
	const rowOpener = page.locator("[data-session-row]")
		.filter({ has: page.getByText(title, { exact: true }) })
		.getByRole("button", { name: /^Open / });
	// The project orchestrator can also be opened directly from the project row.
	return rowOpener.or(page.getByRole("button", { name: `Open ${title}`, exact: true }));
}
