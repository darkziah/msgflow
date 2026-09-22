import { useState } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ContactAvatar({
	name,
	avatarUrl,
	className,
}: {
	name: string;
	avatarUrl: string | null;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const showImage = avatarUrl !== null && !failed;

	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-xs font-semibold text-gray-600",
				className,
			)}
		>
			{showImage ? (
				<img
					src={avatarUrl}
					alt=""
					className="size-full object-cover"
					onError={() => setFailed(true)}
				/>
			) : (
				initials(name)
			)}
		</span>
	);
}
