import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstSignInWalkthrough } from "./FirstSignInWalkthrough";

function renderWalkthrough(onComplete = vi.fn().mockResolvedValue(undefined)) {
	return {
		onComplete,
		...render(
			<>
				<aside data-onboarding-target="sidebar" />
				<div data-onboarding-target="conversation-list" />
				<div data-onboarding-target="conversation-detail" />
				<button data-onboarding-target="settings" type="button">
					Settings
				</button>
				<FirstSignInWalkthrough onComplete={onComplete} />
			</>,
		),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("FirstSignInWalkthrough", () => {
	it("points at each inbox surface as Next and Back move through the tour", () => {
		renderWalkthrough();

		expect(screen.getByRole("dialog")).toHaveTextContent("Find your inboxes");
		expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByRole("dialog")).toHaveTextContent(
			"Choose a conversation",
		);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByRole("dialog")).toHaveTextContent(
			"Read, reply, and collaborate",
		);
		fireEvent.click(screen.getByRole("button", { name: "Back" }));
		expect(screen.getByRole("dialog")).toHaveTextContent(
			"Choose a conversation",
		);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
	});

	it("calls the server-backed completion callback on skip, finish, and Escape", () => {
		const { onComplete, unmount } = renderWalkthrough();
		fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
		expect(onComplete).toHaveBeenCalledTimes(1);
		unmount();

		const finish = vi.fn().mockResolvedValue(undefined);
		const finishedTour = renderWalkthrough(finish);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Finish" }));
		expect(finish).toHaveBeenCalledTimes(1);
		finishedTour.unmount();

		const escapeComplete = vi.fn().mockResolvedValue(undefined);
		renderWalkthrough(escapeComplete);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(escapeComplete).toHaveBeenCalledTimes(1);
	});
});
