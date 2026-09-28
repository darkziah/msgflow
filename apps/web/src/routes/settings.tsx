import type {
	ChannelSummary,
	InboxSummary,
	MetaAppSummary,
	TagSummary,
	TagUpdateRequest,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Cable, Inbox, Mail, Route as RouteIcon, Tags } from "lucide-react";
import { useState } from "react";
import { EmailAdmin } from "@/components/email-admin";
import { TAG_COLOR_OPTIONS, TagChip } from "@/components/inbox/TagChip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

export const Route = createFileRoute("/settings")({ component: Settings });

type SettingsTab = "overview" | "email" | "inboxes" | "channels" | "tags" | "automation";

const sections: { id: SettingsTab; label: string; detail: string; icon: typeof Inbox }[] = [
	{ id: "overview", label: "Overview", detail: "Workspace controls", icon: Cable },
	{ id: "email", label: "Mailboxes", detail: "Domains and delivery", icon: Mail },
	{ id: "inboxes", label: "Inboxes", detail: "Queues and channel routing", icon: Inbox },
	{ id: "channels", label: "Channels", detail: "Facebook connections", icon: Cable },
	{ id: "tags", label: "Tags", detail: "Conversation labels", icon: Tags },
	{ id: "automation", label: "Automation", detail: "Rules and reply library", icon: RouteIcon },
];

export function Settings() {
	const navigate = useNavigate();
	const [tab, setTab] = useState<SettingsTab>("overview");
	const current = sections.find((section) => section.id === tab) ?? sections[0];

	return (
		<main className="min-h-full bg-background px-4 py-6 sm:px-6 lg:px-8">
			<div className="mx-auto max-w-6xl space-y-6">
				<header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Workspace control center</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">Configure queues, channels, mail delivery, labels, and automation. Server permissions remain the source of truth for every change.</p>
					</div>
					<Button type="button" variant="outline" onClick={() => navigate({ to: "/" })}>Back to inbox</Button>
				</header>

				<nav aria-label="Settings sections">
					<Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="hidden md:block">
						<TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1.5">
							{sections.map((section) => <TabsTrigger key={section.id} value={section.id} className="shrink-0" onClick={() => setTab(section.id)}>{section.label}</TabsTrigger>)}
						</TabsList>
					</Tabs>
					<div className="md:hidden">
						<Select value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
							<SelectTrigger aria-label="Settings section" className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>{sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.label}</SelectItem>)}</SelectContent>
						</Select>
					</div>
				</nav>

				<section aria-labelledby={`settings-${tab}`}>
					<div className="mb-5 flex items-start gap-3">
						<current.icon className="mt-0.5 size-5 text-primary" aria-hidden="true" />
						<div><h2 id={`settings-${tab}`} className="font-semibold">{current.label}</h2><p className="text-sm text-muted-foreground">{current.detail}</p></div>
					</div>
					{tab === "overview" ? <Overview onNavigate={setTab} onRules={() => navigate({ to: "/rules" })} /> : null}
					{tab === "email" ? <Card><CardContent className="pt-6"><EmailAdmin /></CardContent></Card> : null}
					{tab === "inboxes" ? <InboxesSection /> : null}
					{tab === "channels" ? <ChannelsSection /> : null}
					{tab === "tags" ? <TagsSection /> : null}
					{tab === "automation" ? <AutomationSection onRules={() => navigate({ to: "/rules" })} /> : null}
				</section>
			</div>
		</main>
	);
}

function Overview({ onNavigate, onRules }: { onNavigate: (tab: SettingsTab) => void; onRules: () => void }) {
	const cards = [
		["Mailboxes", "Set up domains, mailboxes, and delivery readiness.", "Open mailboxes", () => onNavigate("email")],
		["Inboxes", "Create shared queues and attach incoming channels.", "Manage inboxes", () => onNavigate("inboxes")],
		["Channels", "Connect and maintain Facebook Page channels.", "Manage channels", () => onNavigate("channels")],
		["Automation", "Build routing rules and maintain saved replies.", "Manage rules", onRules],
	] as const;
	return <div className="grid gap-4 sm:grid-cols-2">{cards.map(([title, description, action, onClick]) => <Card key={title}><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={onClick}>{action}</Button></CardContent></Card>)}</div>;
}

function AutomationSection({ onRules }: { onRules: () => void }) {
	return <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Routing rules</CardTitle><CardDescription>Automatically assign, tag, route, and respond to inbound messages before they reach a conversation.</CardDescription></CardHeader><CardContent><Button onClick={onRules}>Manage rules</Button></CardContent></Card><Card><CardHeader><CardTitle>Canned replies</CardTitle><CardDescription>Maintain the saved reply library referenced by automation rules.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={onRules}>Manage canned replies</Button></CardContent></Card></div>;
}

function InboxesSection() {
	const queryClient = useQueryClient();
	const inboxes = useQuery({ queryKey: ["inboxes"], queryFn: api.listInboxes });
	const channels = useQuery({ queryKey: ["channels"], queryFn: api.listChannels });
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const create = useMutation({ mutationFn: () => api.createInbox({ name: name.trim() }), onSuccess: () => { setName(""); setError(null); queryClient.invalidateQueries({ queryKey: ["inboxes"] }); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to create inbox.") });
	return <div className="space-y-4"><Card><CardHeader><CardTitle>Shared inboxes</CardTitle><CardDescription>Conversations live in one inbox. Connect channels here to establish their default destination.</CardDescription></CardHeader><CardContent><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}><FieldGroup className="gap-3"><Field><FieldLabel htmlFor="inbox-name">Inbox name</FieldLabel><Input id="inbox-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sales" /></Field><Button type="submit" className="w-fit" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating…" : "Create inbox"}</Button></FieldGroup></form>{error ? <ErrorAlert message={error} /> : null}</CardContent></Card>{inboxes.isPending ? <Loading label="Loading inboxes" /> : null}{inboxes.isError ? <ErrorAlert message={inboxes.error.message} /> : null}{inboxes.data?.inboxes.length === 0 ? <EmptyState title="No inboxes yet" description="Create an inbox to organize incoming conversations." /> : null}<div className="space-y-3">{inboxes.data?.inboxes.map((inbox) => <InboxRow key={inbox.id} inbox={inbox} channels={channels.data?.channels ?? []} onChanged={() => { queryClient.invalidateQueries({ queryKey: ["inboxes"] }); queryClient.invalidateQueries({ queryKey: ["channels"] }); }} />)}</div></div>;
}

function InboxRow({ inbox, channels, onChanged }: { inbox: InboxSummary; channels: ChannelSummary[]; onChanged: () => void }) {
	const [editing, setEditing] = useState(false); const [name, setName] = useState(inbox.name); const [linkId, setLinkId] = useState(""); const [error, setError] = useState<string | null>(null);
	const rename = useMutation({ mutationFn: () => api.updateInbox(inbox.id, { name: name.trim() }), onSuccess: () => { setEditing(false); onChanged(); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to rename inbox.") });
	const remove = useMutation({ mutationFn: () => api.deleteInbox(inbox.id), onSuccess: onChanged, onError: (err) => setError(err instanceof Error ? err.message : "Failed to delete inbox.") });
	const link = useMutation({ mutationFn: (channelId: string) => api.linkChannelToInbox(inbox.id, { channelId, isDefault: true }), onSuccess: () => { setLinkId(""); onChanged(); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to link channel.") });
	const unlink = useMutation({ mutationFn: (channelId: string) => api.unlinkChannelFromInbox(inbox.id, channelId), onSuccess: onChanged, onError: (err) => setError(err instanceof Error ? err.message : "Failed to unlink channel.") });
	const available = channels.filter((channel) => !inbox.channels.some((item) => item.channelId === channel.id));
	return <Card><CardHeader><CardTitle>{editing ? <Input aria-label="Inbox name" value={name} onChange={(event) => setName(event.target.value)} /> : inbox.name}</CardTitle><CardDescription>{inbox.conversationCount} conversations · {inbox.channels.length} channels · {inbox.memberIds.length} members</CardDescription><CardAction><div className="flex gap-2">{editing ? <><Button size="sm" onClick={() => rename.mutate()} disabled={rename.isPending || !name.trim()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></> : <><Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Rename</Button><Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => { if (confirm(`Delete inbox "${inbox.name}"? Its conversations move to another inbox.`)) remove.mutate(); }}>Delete</Button></>}</div></CardAction></CardHeader><CardContent className="space-y-3">{inbox.channels.length ? <div className="flex flex-wrap gap-2">{inbox.channels.map((item) => <Button key={item.channelId} variant="secondary" size="sm" onClick={() => unlink.mutate(item.channelId)}>{item.channelDisplayName}{item.isDefault ? " · default" : ""} ×</Button>)}</div> : null}{available.length ? <Field orientation="responsive"><FieldLabel>Link channel</FieldLabel><Select value={linkId} onValueChange={setLinkId}><SelectTrigger><SelectValue placeholder="Choose a channel" /></SelectTrigger><SelectContent>{available.map((channel) => <SelectItem key={channel.id} value={channel.id}>{channel.displayName}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={!linkId || link.isPending} onClick={() => link.mutate(linkId)}>Link</Button></Field> : null}{error ? <ErrorAlert message={error} /> : null}</CardContent></Card>;
}

function ChannelsSection() {
	const queryClient = useQueryClient(); const channels = useQuery({ queryKey: ["channels"], queryFn: api.listChannels }); const inboxes = useQuery({ queryKey: ["inboxes"], queryFn: api.listInboxes }); const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces }); const workspaceId = workspaces.data?.workspaces[0]?.id;
	const apps = useQuery({ queryKey: ["meta-apps", workspaceId], queryFn: () => workspaceId ? api.listMetaApps(workspaceId) : Promise.resolve({ metaApps: [] }), enabled: Boolean(workspaceId) });
	const [addingApp, setAddingApp] = useState(false); const [addingPage, setAddingPage] = useState(false); const [appName, setAppName] = useState(""); const [appId, setAppId] = useState(""); const [appSecret, setAppSecret] = useState(""); const [metaAppId, setMetaAppId] = useState(""); const [inboxId, setInboxId] = useState(""); const [pageId, setPageId] = useState(""); const [accessToken, setAccessToken] = useState(""); const [mode, setMode] = useState<"oauth" | "manual">("oauth"); const [error, setError] = useState<string | null>(null);
	const createApp = useMutation({ mutationFn: () => { if (!workspaceId) throw new Error("Workspace not found."); return api.createMetaApp(workspaceId, { displayName: appName.trim(), appId: appId.trim(), appSecret: appSecret.trim() }); }, onSuccess: (result) => { setAddingApp(false); setAppName(""); setAppId(""); setAppSecret(""); setMetaAppId(result.metaApp.id); queryClient.invalidateQueries({ queryKey: ["meta-apps"] }); }, onError: (err) => setError(err instanceof Error ? err.message : "Unable to add Meta App.") });
	const connect = useMutation({ mutationFn: async () => { if (!workspaceId) throw new Error("Workspace not found."); if (mode === "manual") return { mode, result: await api.createFacebookChannel(workspaceId, { pageId: pageId.trim(), accessToken: accessToken.trim(), inboxId, metaAppId }) }; return { mode, result: await api.startMetaOAuth(workspaceId, { metaAppId, inboxId }) }; }, onSuccess: (result) => { if (result.mode === "oauth") { window.location.assign(result.result.authorizationUrl); return; } setAddingPage(false); setPageId(""); setAccessToken(""); setInboxId(""); queryClient.invalidateQueries({ queryKey: ["channels"] }); }, onError: (err) => setError(err instanceof Error ? err.message : "Unable to connect the Facebook Page.") });
	return <div className="space-y-4"><Card><CardHeader><CardTitle>Meta Apps</CardTitle><CardDescription>Add an app once, then use it to connect the Pages it is allowed to manage.</CardDescription><CardAction><Button size="sm" variant="outline" onClick={() => setAddingApp((value) => !value)}>{addingApp ? "Cancel" : "Add Meta App"}</Button></CardAction></CardHeader>{addingApp ? <CardContent><form onSubmit={(event) => { event.preventDefault(); createApp.mutate(); }}><FieldGroup className="grid gap-3 sm:grid-cols-3"><Field><FieldLabel htmlFor="meta-app-name">Display name</FieldLabel><Input id="meta-app-name" required value={appName} onChange={(event) => setAppName(event.target.value)} /></Field><Field><FieldLabel htmlFor="meta-app-id">Meta App ID</FieldLabel><Input id="meta-app-id" required value={appId} onChange={(event) => setAppId(event.target.value)} /></Field><Field><FieldLabel htmlFor="meta-app-secret">App secret</FieldLabel><Input id="meta-app-secret" required type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} /></Field><Button type="submit" className="w-fit" disabled={createApp.isPending || !workspaceId || !appName.trim() || !appId.trim() || !appSecret.trim()}>{createApp.isPending ? "Saving…" : "Save Meta App"}</Button></FieldGroup></form></CardContent> : null}<CardContent className="space-y-2">{apps.isPending ? <Loading label="Loading Meta Apps" /> : null}{apps.data?.metaApps.map((app) => <MetaAppRow key={app.id} metaApp={app} workspaceId={workspaceId ?? ""} onChanged={() => queryClient.invalidateQueries({ queryKey: ["meta-apps"] })} />)}</CardContent></Card><Card><CardHeader><CardTitle>Facebook Messenger Page</CardTitle><CardDescription>Connect an eligible Page to a shared inbox. Use Facebook Login or a long-lived Page token.</CardDescription><CardAction><Button size="sm" onClick={() => setAddingPage((value) => !value)}>{addingPage ? "Cancel" : "Add Page channel"}</Button></CardAction></CardHeader>{addingPage ? <CardContent><form onSubmit={(event) => { event.preventDefault(); connect.mutate(); }}><FieldGroup><Field><FieldLabel>Connection method</FieldLabel><div className="flex gap-2"><Button type="button" variant={mode === "oauth" ? "default" : "outline"} onClick={() => setMode("oauth")}>Facebook Login</Button><Button type="button" variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")}>Page token</Button></div></Field><div className="grid gap-3 sm:grid-cols-2"><Field><FieldLabel>Meta App</FieldLabel><Select value={metaAppId} onValueChange={setMetaAppId}><SelectTrigger><SelectValue placeholder="Select Meta App" /></SelectTrigger><SelectContent>{apps.data?.metaApps.map((app) => <SelectItem key={app.id} value={app.id}>{app.displayName} · {app.appId}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>Shared inbox</FieldLabel><Select value={inboxId} onValueChange={setInboxId}><SelectTrigger><SelectValue placeholder="Select shared inbox" /></SelectTrigger><SelectContent>{inboxes.data?.inboxes.filter((inbox) => !inbox.isArchived).map((inbox) => <SelectItem key={inbox.id} value={inbox.id}>{inbox.name}</SelectItem>)}</SelectContent></Select></Field>{mode === "manual" ? <><Field><FieldLabel htmlFor="facebook-page-id">Facebook Page ID</FieldLabel><Input id="facebook-page-id" required value={pageId} onChange={(event) => setPageId(event.target.value)} /></Field><Field><FieldLabel htmlFor="facebook-page-token">Long-lived Page token</FieldLabel><Input id="facebook-page-token" required type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} /></Field></> : null}</div><FieldDescription>{mode === "oauth" ? "Facebook Login lists Pages you can manage under the selected Meta App." : "MsgFlow validates and encrypts the supplied Page token."}</FieldDescription><Button type="submit" className="w-fit" disabled={connect.isPending || !workspaceId || !metaAppId || !inboxId || (mode === "manual" && (!pageId.trim() || !accessToken.trim()))}>{connect.isPending ? "Connecting…" : mode === "oauth" ? "Continue with Facebook Login" : "Connect Page token"}</Button></FieldGroup></form></CardContent> : null}</Card>{error ? <ErrorAlert message={error} /> : null}{channels.isPending ? <Loading label="Loading channels" /> : null}{channels.data?.channels.length === 0 ? <EmptyState title="No channels yet" description="Connect a Facebook Page or provision an email mailbox." /> : null}<div className="space-y-3">{channels.data?.channels.map((channel) => <ChannelRow key={channel.id} channel={channel} onChanged={() => queryClient.invalidateQueries({ queryKey: ["channels"] })} />)}</div></div>;
}

function MetaAppRow({ metaApp, workspaceId, onChanged }: { metaApp: MetaAppSummary; workspaceId: string; onChanged: () => void }) {
	const [editing, setEditing] = useState(false); const [name, setName] = useState(metaApp.displayName); const [secret, setSecret] = useState(""); const [error, setError] = useState<string | null>(null);
	const save = useMutation({ mutationFn: () => api.updateMetaApp(workspaceId, metaApp.id, { displayName: name.trim(), ...(secret.trim() ? { appSecret: secret.trim() } : {}) }), onSuccess: () => { setEditing(false); setSecret(""); onChanged(); }, onError: (err) => setError(err instanceof Error ? err.message : "Unable to update Meta App.") }); const remove = useMutation({ mutationFn: () => api.deleteMetaApp(workspaceId, metaApp.id), onSuccess: onChanged, onError: (err) => setError(err instanceof Error ? err.message : "Unable to delete Meta App.") });
	return <div className="rounded-lg border bg-muted/30 p-3"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{metaApp.displayName}</p><p className="text-xs text-muted-foreground">Meta App ID: {metaApp.appId}</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>Edit</Button><Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button></div></div>{editing ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><FieldGroup className="grid gap-3 sm:grid-cols-2"><Field><FieldLabel>Display name</FieldLabel><Input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>Replace secret</FieldLabel><Input type="password" placeholder="Optional" value={secret} onChange={(event) => setSecret(event.target.value)} /></Field><Button type="submit" className="w-fit" size="sm" disabled={save.isPending || !name.trim()}>Save changes</Button></FieldGroup></form> : null}{error ? <ErrorAlert message={error} /> : null}</div>;
}

function ChannelRow({ channel, onChanged }: { channel: ChannelSummary; onChanged: () => void }) {
	const [token, setToken] = useState(""); const [error, setError] = useState<string | null>(null); const connect = useMutation({ mutationFn: () => api.connectChannel(channel.id, token.trim()), onSuccess: () => { setToken(""); onChanged(); }, onError: (err) => setError(err instanceof Error ? err.message : "Connection failed.") }); const disconnect = useMutation({ mutationFn: () => api.disconnectChannel(channel.id), onSuccess: onChanged, onError: (err) => setError(err instanceof Error ? err.message : "Unable to disconnect channel.") }); const remove = useMutation({ mutationFn: () => api.deleteFacebookChannel(channel.id), onSuccess: onChanged, onError: (err) => setError(err instanceof Error ? err.message : "Unable to remove Page channel.") });
	return <Card><CardHeader><CardTitle>{channel.displayName}</CardTitle><CardDescription>{channel.type === "facebook_page" ? "Facebook Page" : "Email"} · {channel.externalId} · {channel.hasToken ? "Connected" : channel.status === "disconnected" ? "Disconnected" : "Not connected"}</CardDescription><CardAction><div className="flex gap-2">{channel.hasToken ? <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button> : null}{channel.type === "facebook_page" ? <Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete Page</Button> : null}</div></CardAction></CardHeader>{channel.type === "facebook_page" ? <CardContent><form onSubmit={(event) => { event.preventDefault(); connect.mutate(); }}><Field orientation="responsive"><FieldLabel htmlFor={`channel-token-${channel.id}`}>Page token</FieldLabel><Input id={`channel-token-${channel.id}`} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={channel.hasToken ? "Paste a replacement Page token" : "Paste a Page token"} /><Button type="submit" size="sm" disabled={connect.isPending || !token.trim()}>{connect.isPending ? "Saving…" : channel.hasToken ? "Rotate token" : "Connect"}</Button></Field></form>{error ? <ErrorAlert message={error} /> : null}</CardContent> : null}</Card>;
}

function TagsSection() {
	const queryClient = useQueryClient(); const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags }); const [name, setName] = useState(""); const [color, setColor] = useState("blue"); const [error, setError] = useState<string | null>(null); const create = useMutation({ mutationFn: () => api.createTag({ name: name.trim(), color }), onSuccess: () => { setName(""); setColor("blue"); setError(null); queryClient.invalidateQueries({ queryKey: ["tags"] }); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to create tag.") });
	return <div className="space-y-4"><Card><CardHeader><CardTitle>Conversation tags</CardTitle><CardDescription>Labels available for conversation organization and filtering.</CardDescription></CardHeader><CardContent><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}><FieldGroup className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"><Field><FieldLabel htmlFor="tag-name">Tag name</FieldLabel><Input id="tag-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Urgent" /></Field><Field><FieldLabel>Color</FieldLabel><Select value={color} onValueChange={setColor}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TAG_COLOR_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field><Button type="submit" className="self-end" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating…" : "Create tag"}</Button></FieldGroup></form>{error ? <ErrorAlert message={error} /> : null}</CardContent></Card>{tags.isPending ? <Loading label="Loading tags" /> : null}{tags.isError ? <ErrorAlert message={tags.error.message} /> : null}{tags.data?.tags.length === 0 ? <EmptyState title="No tags yet" description="Create a tag to label and filter conversations." /> : null}<div className="space-y-3">{tags.data?.tags.map((tag) => <TagRow key={tag.id} tag={tag} onChanged={() => queryClient.invalidateQueries({ queryKey: ["tags"] })} />)}</div></div>;
}

function TagRow({ tag, onChanged }: { tag: TagSummary; onChanged: () => void }) {
	const [editing, setEditing] = useState(false); const [name, setName] = useState(tag.name); const [color, setColor] = useState(tag.color ?? "gray"); const [error, setError] = useState<string | null>(null); const update = useMutation({ mutationFn: () => api.updateTag(tag.id, { name: name.trim(), color } satisfies TagUpdateRequest), onSuccess: () => { setEditing(false); onChanged(); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to update tag.") }); const remove = useMutation({ mutationFn: () => api.deleteTag(tag.id), onSuccess: onChanged, onError: (err) => setError(err instanceof Error ? err.message : "Failed to delete tag.") });
	return <Card><CardContent className="flex items-center justify-between gap-3 pt-6">{editing ? <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2"><Field className="min-w-48 flex-1"><FieldLabel>Tag name</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>Color</FieldLabel><Select value={color} onValueChange={setColor}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TAG_COLOR_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field><Button size="sm" disabled={update.isPending || !name.trim()} onClick={() => update.mutate()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div> : <TagChip tag={{ ...tag, name: tag.name, color }} />}<div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button><Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => { if (confirm(`Delete tag "${tag.name}"?`)) remove.mutate(); }}>Delete</Button></div></CardContent>{error ? <CardContent><ErrorAlert message={error} /></CardContent> : null}</Card>;
}

function Loading({ label }: { label: string }) { return <Card aria-label={label}><CardContent className="space-y-3 pt-6"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-14 w-full" /></CardContent></Card>; }
function EmptyState({ title, description }: { title: string; description: string }) { return <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>; }
function ErrorAlert({ message }: { message: string }) { return <Alert variant="destructive" className="mt-3"><AlertTitle>Something went wrong</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>; }
