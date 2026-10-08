import { describe, expect, test } from "bun:test";
import type {
	Activity,
	Comment,
	ConversationListResponse,
	ConversationSummary,
	Message,
	PageInfo,
	TimelineItem,
	TimelinePageResponse,
} from "./index";

describe("cursor pagination contract types", () => {
	test("models cursor pages for conversations and mixed timeline items", () => {
		const pageInfo: PageInfo = { nextCursor: "cursor-2" };
		const conversations: ConversationListResponse = {
			nextCursor: null,
			conversations: [{} as ConversationSummary],
		};
		const items = [
			{ type: "message", item: {} as Message },
			{ type: "comment", item: {} as Comment },
			{ type: "activity", item: {} as Activity },
		] satisfies TimelineItem[];
		const timeline: TimelinePageResponse = {
			nextCursor: pageInfo.nextCursor,
			items,
		};

		expect(conversations.nextCursor).toBeNull();
		expect(timeline.items.map(({ type }) => type)).toEqual([
			"message",
			"comment",
			"activity",
		]);
	});
});
