import worker from "../../src/index";
import { ConversationDO as BaseConversationDO } from "../../src/conversation-do";

export class ConversationDO extends BaseConversationDO {
	override async fetch(request: Request): Promise<Response> {
		if (new URL(request.url).pathname === "/timeline") {
			throw new Error("durable object unavailable");
		}
		return super.fetch(request);
	}
}

export { CallDispatchDO } from "../../src/call-dispatch-do";
export { CallSessionDO } from "../../src/call-session-do";
export { WorkspaceEventsDO } from "../../src/workspace-events-do";
export default worker;
