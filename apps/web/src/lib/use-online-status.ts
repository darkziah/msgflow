import { useEffect, useState } from "react";

function browserIsOnline(): boolean {
	return typeof navigator === "undefined" || navigator.onLine;
}

/** Browser-safe connection state for pausing network polling while offline. */
export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(browserIsOnline);

	useEffect(() => {
		const update = () => setOnline(browserIsOnline());
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);

	return online;
}
