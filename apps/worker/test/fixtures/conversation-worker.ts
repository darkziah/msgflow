export { ConversationDO } from "../../src/conversation-do";
export { CallDispatchDO } from "../../src/call-dispatch-do";
export { CallSessionDO } from "../../src/call-session-do";
export default {
	fetch() {
		return new Response("test worker");
	},
};
