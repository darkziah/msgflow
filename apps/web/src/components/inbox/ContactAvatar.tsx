import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
	return (
		<Avatar className={cn(className)}>
			{avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
			<AvatarFallback>{initials(name)}</AvatarFallback>
		</Avatar>
	);
}
