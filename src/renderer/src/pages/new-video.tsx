import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
	ArrowRight,
	BookOpen,
	CircleAlert,
	Cpu,
	Eye,
	FileImage,
	FileText,
	FileType,
	Globe,
	Image as ImageIcon,
	Keyboard,
	Layers,
	Lightbulb,
	Loader2,
	Plus,
	RotateCcw,
	ScanText,
	Sparkles,
	Square,
	Trash2,
	UploadCloud,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ingestChannels as ch, LEVELS, type Capabilities, type DraftView, type OcrMode } from "@shared/ipc/ingest";
import { plannerChannels as pc } from "@shared/ipc/planner";
import { LANGUAGES, lengthLabel, TARGET_MINUTES, TONES, TopicRequest, VIDEO_FORMATS, type Estimate, type VideoFormat } from "@shared/planner";
import { countWords, parsePageRange, type InputKind, type Source } from "@shared/source";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Segmented } from "@renderer/components/ui/misc";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, PageHeader, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { bytes } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { isRunning, newItemId, useIngest, type Item } from "@renderer/stores/ingest";
import { confirmCost, EstimateCard, PlanWizard } from "./plan-wizard";

const TYPES = [
	{ icon: FileText, label: "PDF" },
	{ icon: FileType, label: "Word" },
	{ icon: Globe, label: "HTML" },
	{ icon: FileText, label: "Markdown / TXT" },
	{ icon: FileImage, label: "Images" },
	{ icon: Keyboard, label: "Typed text" },
];

const KIND_ICON: Record<InputKind, LucideIcon> = { pdf: FileText, image: FileImage, docx: FileType, doc: FileType, html: Globe, md: FileText, txt: FileText, text: Keyboard };
const KIND_LABEL: Record<InputKind, string> = { pdf: "PDF", image: "Image", docx: "Word", doc: "Word 97–2003", html: "Web page", md: "Markdown", txt: "Text", text: "Typed text" };

async function addPaths(paths: string[]) {
	if (!paths.length) return;
	try {
		const files = await call(ch.inspect, { paths });
		addFiles(files);
		if (files.length < paths.length) toast.warning(`${paths.length - files.length} file(s) were skipped`, { description: "Only PDF, Word, HTML, Markdown, text and image files can be read." });
	} catch (err) {
		toast.error("Could not add the files", { description: errorText(err) });
	}
}

function addFiles(files: Awaited<ReturnType<typeof call<typeof ch.pick>>>) {
	const have = new Set(useIngest.getState().items.flatMap((i) => (i.kind === "file" ? [i.file.path.toLowerCase()] : [])));
	const fresh = files.filter((f) => !have.has(f.path.toLowerCase()));
	useIngest.setState((s) => ({ items: [...s.items, ...fresh.map((file) => ({ id: newItemId(), kind: "file" as const, file, pages: "" }))] }));
}

// Test hook for the dev harness (EXPLAINER_INGEST_TEST). It carries no trust: main only reads files it admitted itself.
(window as unknown as { __addFiles: typeof addFiles }).__addFiles = addFiles;

/** Pages a range selects, or an error message. */
function pagesInfo(range: string, max: number | null): { count: number | null; error: string | null } {
	if (!max) return { count: null, error: null };
	try {
		return { count: parsePageRange(range, max).length, error: null };
	} catch (err) {
		return { count: null, error: (err as Error).message };
	}
}

function TextDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial?: Extract<Item, { kind: "text" }> }) {
	const [title, setTitle] = useState("");
	const [text, setText] = useState("");
	useEffect(() => {
		if (open) {
			setTitle(initial?.title ?? "");
			setText(initial?.text ?? "");
		}
	}, [open, initial]);
	const save = () => {
		const t = text.trim();
		if (!t) return;
		useIngest.setState((s) => ({
			items: initial
				? s.items.map((i) => (i.id === initial.id ? { ...initial, title: title.trim(), text: t } : i))
				: [...s.items, { id: newItemId(), kind: "text", title: title.trim(), text: t }],
		}));
		onOpenChange(false);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={initial ? "Edit text" : "Type or paste text"} description="Notes, a chapter, or a lesson plan. Lines starting with # become headings." className="w-[min(92vw,720px)]">
				<div className="mt-4 space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor="txt-title">Title (optional)</Label>
						<Input id="txt-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Photosynthesis notes" />
					</div>
					<div className="space-y-1.5">
						<div className="flex items-center justify-between">
							<Label htmlFor="txt-body">Text</Label>
							<span className="text-[12px] tabular-nums text-muted-foreground">{countWords(text)} words</span>
						</div>
						<Textarea id="txt-body" value={text} onChange={(e) => setText(e.target.value)} rows={14} maxLength={2_000_000} placeholder="Paste or type your material here…" className="font-[inherit]" />
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={save} disabled={!text.trim()}>
						{initial ? "Save" : "Add text"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ItemRow({ item, caps, onEdit }: { item: Item; caps: Capabilities | null; onEdit: () => void }) {
	const remove = () => useIngest.setState((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
	if (item.kind === "text") {
		return (
			<li className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
					<Keyboard className="size-4" />
				</span>
				<button className="min-w-0 flex-1 text-left" onClick={onEdit}>
					<p className="truncate text-[13px] font-medium">{item.title || "Typed text"}</p>
					<p className="truncate text-[12px] text-muted-foreground">
						{countWords(item.text)} words · {item.text.slice(0, 80)}
					</p>
				</button>
				<Button variant="subtle" size="icon-sm" aria-label={`Remove ${item.title || "typed text"}`} onClick={remove}>
					<Trash2 />
				</Button>
			</li>
		);
	}
	const f = item.file;
	const Icon = KIND_ICON[f.kind];
	const info = pagesInfo(item.pages, f.pageCount);
	const needsLo = f.kind === "doc" && caps && !caps.libreOffice;
	return (
		<li className="rounded-xl border bg-card px-3.5 py-3">
			<div className="flex items-center gap-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
					<Icon className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate text-[13px] font-medium" title={f.path}>
						{f.name}
					</p>
					<p className="text-[12px] text-muted-foreground">
						{KIND_LABEL[f.kind]} · {bytes(f.bytes)}
						{f.pageCount ? ` · ${f.pageCount} pages` : ""}
					</p>
				</div>
				{f.kind === "pdf" && f.pageCount ? (
					<div className="w-44">
						<Input
							aria-label={`Pages to read from ${f.name}`}
							value={item.pages}
							onChange={(e) => useIngest.setState((s) => ({ items: s.items.map((i) => (i.id === item.id ? { ...i, pages: e.target.value } : i)) }))}
							placeholder={`All ${f.pageCount} pages`}
							aria-invalid={!!info.error}
							className={cn("h-8 text-[13px]", info.error && "border-danger focus-visible:ring-danger/20")}
						/>
					</div>
				) : null}
				<Button variant="subtle" size="icon-sm" aria-label={`Remove ${f.name}`} onClick={remove}>
					<Trash2 />
				</Button>
			</div>
			{info.error ? <p className="mt-2 pl-12 text-[12px] text-danger">{info.error}</p> : null}
			{f.kind === "pdf" && info.count && item.pages.trim() ? <p className="mt-1.5 pl-12 text-[12px] text-muted-foreground">{info.count} page(s) will be read.</p> : null}
			{needsLo ? (
				<p className="mt-2 flex gap-1.5 pl-12 text-[12px] text-warning" role="alert">
					<CircleAlert className="mt-0.5 size-3.5 shrink-0" />
					Old Word files need LibreOffice, which is not installed. Save it as .docx in Word, or install LibreOffice (free) from libreoffice.org.
				</p>
			) : null}
		</li>
	);
}

function MaterialCard({ caps }: { caps: Capabilities | null }) {
	const items = useIngest((s) => s.items);
	const [dragging, setDragging] = useState(false);
	const [textOpen, setTextOpen] = useState(false);
	const [editing, setEditing] = useState<Extract<Item, { kind: "text" }> | undefined>();

	const pick = async () => {
		try {
			addFiles(await call(ch.pick));
		} catch (err) {
			toast.error("Could not open the file picker", { description: errorText(err) });
		}
	};
	const dropProps = {
		onDragOver: (e: React.DragEvent) => {
			e.preventDefault();
			setDragging(true);
		},
		onDragLeave: () => setDragging(false),
		onDrop: (e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			void addPaths([...e.dataTransfer.files].map((f) => window.studio.pathForFile(f)).filter(Boolean));
		},
	};
	const openText = (item?: Extract<Item, { kind: "text" }>) => {
		setEditing(item);
		setTextOpen(true);
	};

	return (
		<>
			{items.length === 0 ? (
				<Card className={cn("flex flex-col items-center justify-center border-2 border-dashed px-8 py-16 text-center transition-colors", dragging && "border-primary bg-primary-soft/40")} {...dropProps}>
					<div className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
						<UploadCloud className="size-7" strokeWidth={1.75} />
					</div>
					<h2 className="mt-5 text-[17px] font-semibold tracking-tight">Drop files here</h2>
					<p className="mt-1.5 max-w-sm text-sm text-muted-foreground">A whole chapter, a few pages, or a single photo. Scanned pages are read too.</p>
					<div className="mt-5 flex flex-wrap justify-center gap-1.5">
						{TYPES.map((t) => (
							<span key={t.label} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[12px] text-muted-foreground">
								<t.icon className="size-3.5" />
								{t.label}
							</span>
						))}
					</div>
					<div className="mt-6 flex items-center gap-2">
						<Button variant="outline" onClick={() => void pick()}>
							Choose files
						</Button>
						<Button variant="ghost" onClick={() => openText()}>
							Type or paste text
						</Button>
					</div>
				</Card>
			) : (
				<Card className={cn("transition-colors", dragging && "border-primary bg-primary-soft/30")} {...dropProps}>
					<CardHeader className="flex-row items-center justify-between space-y-0">
						<div>
							<CardTitle>Material</CardTitle>
							<CardDescription className="mt-1">For long PDFs, type the pages to read, like 81-85. Drop more files here to add them.</CardDescription>
						</div>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={() => void pick()}>
								<Plus />
								Add files
							</Button>
							<Button variant="ghost" size="sm" onClick={() => openText()}>
								<Keyboard />
								Add text
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<ul className="space-y-2">
							{items.map((i) => (
								<ItemRow key={i.id} item={i} caps={caps} onEdit={() => i.kind === "text" && openText(i)} />
							))}
						</ul>
					</CardContent>
				</Card>
			)}
			<TextDialog open={textOpen} onOpenChange={setTextOpen} initial={editing} />
		</>
	);
}

const STAGE_LABEL: Record<string, string> = { text: "Reading the text layer", figures: "Finding pictures and figures", ocr: "Reading scanned pages", pages: "Reading pages", saving: "Putting it together", research: "Writing" };
const METHOD_LABEL: Record<string, string> = { vision: "AI vision", "local-ocr": "this PC", text: "text layer" };

function ReadingPanel() {
	const { update, tracks, items, jobId, mode } = useIngest();
	const topic = mode === "topic";
	const p = update?.progress;
	const pct = Math.round((p?.progress ?? 0) * 100);
	const file = p ? items.filter((i) => i.kind === "file" || i.kind === "text")[p.fileIndex] : undefined;
	const track = p ? tracks[p.fileIndex] : undefined;
	const pageList = useMemo(() => {
		if (!file || file.kind !== "file" || !file.file.pageCount) return null;
		try {
			return parsePageRange(file.pages, file.file.pageCount);
		} catch {
			return null;
		}
	}, [file]);
	const stop = async () => {
		const ok = await confirm(
			topic
				? { title: "Stop writing?", description: "The material written so far is thrown away. Nothing is saved. AI calls already made still count.", confirmLabel: "Stop writing", cancelLabel: "Keep writing", tone: "danger" }
				: { title: "Stop reading?", description: "The material read so far is thrown away. Nothing is saved.", confirmLabel: "Stop reading", cancelLabel: "Keep reading", tone: "danger" },
		);
		if (ok && jobId) await call(ch.cancel, { jobId }).catch((err) => toast.error("Could not stop", { description: errorText(err) }));
	};
	const grid = pageList && pageList.length <= 400 ? pageList : null;
	return (
		<Card aria-live="polite">
			<CardHeader>
				<div className="flex items-center gap-2">
					<Loader2 className="size-4 animate-spin text-primary" />
					<CardTitle>{topic ? "Writing your material" : "Reading your material"}</CardTitle>
				</div>
				<CardDescription>{!p ? "Starting…" : topic ? `Topic: ${p.fileName}` : `File ${p.fileIndex + 1} of ${p.fileCount}: ${p.fileName}`}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="rounded-xl border bg-subtle p-4">
					<div className="mb-2 flex items-center gap-2 text-[13px]">
						<span className="font-medium">{p ? STAGE_LABEL[p.stage] : "Starting"}</span>
						<span className="min-w-0 truncate text-muted-foreground">{p?.detail}</span>
						<span className="ml-auto font-medium tabular-nums">{pct}%</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={topic ? "Writing progress" : "Reading progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
						<div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
					</div>
					{p?.pageCount && p.pageIndex !== undefined ? (
						<p className="mt-2 text-[12px] text-muted-foreground">
							Page {Math.min(p.pageIndex + 1, p.pageCount)} of {p.pageCount}
							{p.method ? ` · ${METHOD_LABEL[p.method]}` : ""}
						</p>
					) : null}
				</div>
				{grid && track ? (
					<div>
						<div className="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
							<span>Pages</span>
							<span className="flex items-center gap-3">
								<span className="flex items-center gap-1.5">
									<span className="size-2.5 rounded-sm bg-success" /> Done
								</span>
								<span className="flex items-center gap-1.5">
									<span className="size-2.5 rounded-sm bg-primary" /> Now
								</span>
								<span className="flex items-center gap-1.5">
									<span className="size-2.5 rounded-sm bg-muted" /> Waiting
								</span>
							</span>
						</div>
						<div className="flex flex-wrap gap-1" role="list" aria-label="Page progress">
							{grid.map((pg) => {
								const done = track.done.includes(pg) || (track.current !== null && grid.indexOf(pg) < grid.indexOf(track.current) && track.stage.startsWith("text"));
								const now = track.current === pg;
								return (
									<span
										key={pg}
										role="listitem"
										title={`Page ${pg}`}
										aria-label={`Page ${pg}: ${now ? "reading" : done ? "done" : "waiting"}`}
										className={cn(
											"grid h-7 min-w-9 place-items-center rounded-md px-1 text-[11px] font-medium tabular-nums transition-colors",
											now ? "bg-primary text-primary-foreground" : done ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
										)}
									>
										{pg}
									</span>
								);
							})}
						</div>
					</div>
				) : null}
				<Button variant="outline" onClick={() => void stop()}>
					<Square className="fill-current" />
					{topic ? "Stop writing" : "Stop reading"}
				</Button>
			</CardContent>
		</Card>
	);
}

function FigureThumb({ draftId, figure }: { draftId: string; figure: Source["figures"][number] }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		void call(ch.figure, { draftId, figureId: figure.id })
			.then((r) => live && setUrl(r.url))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [draftId, figure.id]);
	return (
		<figure className="overflow-hidden rounded-xl border bg-card">
			<div className="grid aspect-[4/3] place-items-center bg-subtle">{url ? <img src={url} alt={figure.caption ?? "Figure"} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-5 text-muted-foreground" />}</div>
			<figcaption className="truncate border-t px-2.5 py-1.5 text-[12px] text-muted-foreground" title={figure.caption ?? undefined}>
				{figure.caption ?? (figure.page ? `Page ${figure.page}` : "Figure")}
			</figcaption>
		</figure>
	);
}

function SourcePreview({ draftId }: { draftId: string }) {
	const navigate = useNavigate();
	const [draft, setDraft] = useState<DraftView | null>(null);
	const topic = useIngest((x) => x.mode === "topic");
	const reset = () => useIngest.setState((x) => ({ items: [], jobId: null, update: null, tracks: {}, draftId: null, topic: { ...x.topic, topic: "", instructions: "" } }));
	useEffect(() => {
		void call(ch.draft, { id: draftId })
			.then(setDraft)
			.catch(() => {
				// The draft was deleted (or cannot be read): start over instead of waiting forever.
				useIngest.setState({ jobId: null, update: null, tracks: {}, draftId: null });
			});
	}, [draftId]);
	// The draft lives on in Drafts; the next New video starts with an empty form.
	const continueToOutline = () => {
		reset();
		void navigate({ to: "/new", search: { draft: draftId } });
	};
	if (!draft)
		return (
			<Card>
				<CardHeader>
					<CardDescription className="flex items-center gap-2">
						<Loader2 className="size-4 animate-spin" /> Opening the draft…
					</CardDescription>
				</CardHeader>
			</Card>
		);
	const s = draft.source;
	const ocrPages = s.inputs.reduce((n, i) => n + i.ocr.length, 0);
	const vision = s.inputs.reduce((n, i) => n + i.ocr.filter((o) => o.method === "vision").length, 0);
	const outline = s.sections.filter((x) => x.heading);
	return (
		<div className="space-y-5">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<Badge tone="success">Saved as draft</Badge>
						<span className="text-[12px] text-muted-foreground">{draft.level}</span>
					</div>
					<CardTitle className="mt-1 text-lg" data-selectable>
						{draft.title}
					</CardTitle>
					<CardDescription>{s.inputs.map((i) => i.name).join(", ")}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<dl className="grid grid-cols-4 gap-3">
						{[
							{ k: "Words", v: s.stats.words.toLocaleString(), icon: BookOpen },
							{ k: "Sections", v: String(s.sections.length), icon: Layers },
							{ k: "Figures", v: String(s.figures.length), icon: ImageIcon },
							{ k: "Pages read as pictures", v: ocrPages ? `${ocrPages} (${vision} AI)` : "0", icon: ScanText },
						].map((x) => (
							<div key={x.k} className="rounded-xl border bg-subtle px-3.5 py-3">
								<dt className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
									<x.icon className="size-3.5" />
									{x.k}
								</dt>
								<dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{x.v}</dd>
							</div>
						))}
					</dl>
					{s.warnings.length ? (
						<div role="alert" className="space-y-1.5 rounded-xl border border-warning/30 bg-warning-soft p-4 text-[13px]">
							<p className="flex items-center gap-2 font-medium">
								<CircleAlert className="size-4 text-warning" />
								Things to check
							</p>
							<ul className="list-disc space-y-1 pl-10 text-muted-foreground">
								{s.warnings.map((w) => (
									<li key={w} data-selectable>
										{w}
									</li>
								))}
							</ul>
						</div>
					) : null}
					<div className="flex gap-2">
						<Button onClick={continueToOutline}>
							Continue to outline <ArrowRight />
						</Button>
						<Button variant="outline" onClick={reset}>
							<RotateCcw />
							{topic ? "Write about something else" : "Read something else"}
						</Button>
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>What was found</CardTitle>
					<CardDescription>Headings in the order they appear. The planner uses all of the text.</CardDescription>
				</CardHeader>
				<CardContent>
					{outline.length ? (
						<ol className="space-y-1">
							{outline.slice(0, 60).map((x) => {
								const first = x.blocks.find((b) => b.type === "paragraph");
								return (
									<li key={x.id} className="rounded-lg px-2 py-1.5 hover:bg-subtle" style={{ paddingLeft: `${(x.level - 1) * 18 + 8}px` }}>
										<div className="flex items-baseline gap-2">
											<span className={cn("text-[13px]", x.level === 1 ? "font-semibold" : "font-medium")}>{x.heading}</span>
											{x.page ? <span className="text-[11px] tabular-nums text-muted-foreground">p. {x.page}</span> : null}
										</div>
										{first && first.type === "paragraph" ? <p className="line-clamp-1 text-[12px] text-muted-foreground">{first.text}</p> : null}
									</li>
								);
							})}
							{outline.length > 60 ? <li className="px-2 text-[12px] text-muted-foreground">… and {outline.length - 60} more headings</li> : null}
						</ol>
					) : (
						<p className="text-[13px] text-muted-foreground">No headings were found. The text is kept as one section.</p>
					)}
				</CardContent>
			</Card>
			{s.figures.length ? (
				<Card>
					<CardHeader>
						<CardTitle>Figures</CardTitle>
						<CardDescription>Pictures from the material. Scenes can reuse them.</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-4 gap-3">
							{s.figures.slice(0, 12).map((f) => (
								<FigureThumb key={f.id} draftId={draft.id} figure={f} />
							))}
						</div>
						{s.figures.length > 12 ? <p className="mt-3 text-[12px] text-muted-foreground">… and {s.figures.length - 12} more</p> : null}
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}

const EXAMPLE_TOPICS = ["How vaccines train the immune system", "Photosynthesis, step by step", "Why the Roman Empire fell", "How a CPU runs a program", "Supply and demand"];

/** "From a topic": the AI writes the material. The user checks it before the outline. */
function TopicCard() {
	const form = useIngest((s) => s.topic);
	const set = (patch: Partial<typeof form>) => useIngest.setState((s) => ({ topic: { ...s.topic, ...patch } }));
	return (
		<Card>
			<CardHeader>
				<CardTitle>What should the video teach?</CardTitle>
				<CardDescription className="mt-1">The AI writes study notes on the topic. You check them, then the outline, before any video is made.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-1.5">
					<Label htmlFor="topic-text">Topic</Label>
					<Textarea
						id="topic-text"
						value={form.topic}
						onChange={(e) => set({ topic: e.target.value })}
						rows={3}
						maxLength={500}
						placeholder="For example: How black holes form, and why nothing escapes them"
						className="font-[inherit]"
					/>
					<div className="flex flex-wrap items-center gap-1.5 pt-1">
						<Lightbulb className="size-3.5 text-muted-foreground" />
						{EXAMPLE_TOPICS.map((t) => (
							<button key={t} type="button" onClick={() => set({ topic: t })} className="rounded-full border bg-card px-2.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								{t}
							</button>
						))}
					</div>
				</div>
				<div className="space-y-1.5">
					<Label>Format</Label>
					<div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Video format">
						{(Object.keys(VIDEO_FORMATS) as VideoFormat[]).map((f) => {
							const on = form.format === f;
							const v = VIDEO_FORMATS[f];
							return (
								<button
									key={f}
									type="button"
									role="radio"
									aria-checked={on}
									// Shorts are short: picking vertical suggests 1 minute when the length is long.
									onClick={() => set({ format: f, minutes: f === "vertical" && form.minutes > 3 ? 1 : form.minutes })}
									className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors", on ? "border-primary bg-primary-soft" : "hover:bg-accent")}
								>
									<span className={cn("shrink-0 rounded-[3px] border-2", on ? "border-primary" : "border-muted-foreground/60", f === "vertical" ? "h-7 w-4" : "h-4 w-7")} />
									<span>
										<span className="block text-[13px] font-medium">{v.label}</span>
										<span className="block text-[12px] text-muted-foreground">{v.hint}</span>
									</span>
								</button>
							);
						})}
					</div>
				</div>
				<div className="grid grid-cols-3 gap-3">
					<div className="space-y-1.5">
						<Label>Length</Label>
						<Select ariaLabel="Video length" value={String(form.minutes)} onChange={(v) => set({ minutes: Number(v) })} options={TARGET_MINUTES.filter((m) => m <= 60).map((m) => ({ value: String(m), label: `About ${lengthLabel(m)}` }))} />
					</div>
					<div className="space-y-1.5">
						<Label>Language</Label>
						<Select ariaLabel="Narration language" value={form.language} onChange={(v) => set({ language: v })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
					</div>
					<div className="space-y-1.5">
						<Label>Tone</Label>
						<Select ariaLabel="Tone" value={form.tone} onChange={(v) => set({ tone: v })} options={TONES.map((t) => ({ value: t, label: t }))} />
					</div>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="topic-notes">What to cover (optional)</Label>
					<Textarea
						id="topic-notes"
						value={form.instructions}
						onChange={(e) => set({ instructions: e.target.value })}
						rows={4}
						maxLength={3000}
						placeholder={"Points to include, examples to use, things to leave out, what viewers already know.\nFor example: Use a football as the example. Skip the maths. Viewers know what a cell is."}
						className="font-[inherit]"
					/>
				</div>
			</CardContent>
		</Card>
	);
}

/** Cost estimate and the start button for "From a topic". */
function TopicRun() {
	const { topic: form, level, update } = useIngest();
	const running = isRunning(update);
	const req = TopicRequest.safeParse({ ...form, level });
	const key = req.success ? JSON.stringify(req.data) : null;
	const [est, setEst] = useState<{ value: Estimate | null; error: string | null; loading: boolean }>({ value: null, error: null, loading: false });
	useEffect(() => {
		if (!key) return;
		let live = true;
		setEst((e) => ({ ...e, loading: true }));
		const t = setTimeout(() => {
			void call(pc.topicEstimate, JSON.parse(key) as TopicRequest)
				.then((value) => live && setEst({ value, error: null, loading: false }))
				.catch((err) => live && setEst({ value: null, error: errorText(err), loading: false }));
		}, 400);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [key]);

	const start = async () => {
		if (!req.success) return;
		try {
			const e = await call(pc.topicEstimate, req.data);
			const confirmed = await confirmCost(e, "Writing the material");
			if (confirmed === null) return;
			const r = await call(pc.topicStart, { ...req.data, confirmedCost: confirmed });
			useIngest.setState({ jobId: r.jobId, update: { jobId: r.jobId, state: "running", progress: null }, tracks: {}, draftId: null });
		} catch (err) {
			toast.error("Could not start writing", { description: errorText(err) });
		}
	};

	return (
		<>
			{key ? <EstimateCard step="research" est={est} /> : null}
			<Button className="w-full" disabled={!req.success || running || !!est.error} loading={running} onClick={() => void start()}>
				<Sparkles />
				Write material <ArrowRight />
			</Button>
			{!req.success ? <p className="text-center text-[12px] text-muted-foreground">Type a topic first.</p> : null}
		</>
	);
}

function Capability({ icon: Icon, ok, label, detail, action }: { icon: LucideIcon; ok: boolean; label: string; detail: string; action?: React.ReactNode }) {
	return (
		<div className="flex gap-2.5 text-[12px]">
			<Icon className={cn("mt-0.5 size-3.5 shrink-0", ok ? "text-success" : "text-muted-foreground")} />
			<div className="min-w-0">
				<p className="font-medium text-foreground">{label}</p>
				<p className="text-muted-foreground">
					{detail} {action}
				</p>
			</div>
		</div>
	);
}

export function NewVideoPage() {
	const { draft } = useSearch({ strict: false });
	if (draft)
		return (
			<div>
				<PageHeader title="New video" description="Check the outline, then let the AI write the script and scenes." />
				<PlanWizard key={draft} draftId={draft} />
			</div>
		);
	return <MaterialStep />;
}

function MaterialStep() {
	const { items, level, ocr, update, draftId, mode } = useIngest();
	const [caps, setCaps] = useState<Capabilities | null>(null);
	useEffect(() => {
		void call(ch.capabilities).then(setCaps).catch(() => {});
	}, []);
	const running = isRunning(update);
	const showResult = !running && update?.state === "done" && !!draftId;

	const badRange = items.some((i) => i.kind === "file" && !!pagesInfo(i.pages, i.file.pageCount).error);
	const canRead = items.length > 0 && !running && !badRange;

	const read = async () => {
		try {
			const r = await call(ch.start, {
				items: items.map((i) => (i.kind === "file" ? { kind: "file" as const, path: i.file.path, pages: i.pages.trim() || undefined } : { kind: "text" as const, text: i.text, title: i.title || undefined })),
				ocr,
				level,
			});
			useIngest.setState({ jobId: r.jobId, update: { jobId: r.jobId, state: "running", progress: null }, tracks: {}, draftId: null });
		} catch (err) {
			toast.error("Could not start reading", { description: errorText(err) });
		}
	};

	const ocrOptions: { value: OcrMode; label: string; hint?: string }[] = [
		{ value: "auto", label: "AI vision, then this PC", hint: "Best" },
		{ value: "vision", label: "AI vision only" },
		{ value: "local", label: "This PC only", hint: "Offline, free" },
	];

	return (
		<div>
			<PageHeader
				title="New video"
				description={mode === "topic" ? "Describe a topic, choose the audience, and the AI writes the material. You check it before the outline." : "Add your material, choose the audience, and we will draft an outline for you to approve."}
			/>
			<div className="grid grid-cols-[1fr_340px] items-start gap-5">
				<div className="min-w-0 space-y-4">
					{!running && !showResult ? (
						<Segmented
							ariaLabel="Where the material comes from"
							value={mode}
							onChange={(v) => useIngest.setState({ mode: v })}
							options={[
								{ value: "files", label: "From my material", icon: UploadCloud },
								{ value: "topic", label: "From a topic (AI writes it)", icon: Sparkles },
							]}
						/>
					) : null}
					{running ? <ReadingPanel /> : showResult ? <SourcePreview draftId={draftId} /> : mode === "topic" ? <TopicCard /> : <MaterialCard caps={caps} />}
				</div>

				<div className="space-y-5">
					<Card>
						<CardHeader>
							<CardTitle>Audience</CardTitle>
							<CardDescription>Sets the words, pace and visuals of every scene.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-1.5">
							{LEVELS.map((l) => (
								<button
									key={l}
									disabled={running}
									onClick={() => useIngest.setState({ level: l })}
									className={cn(
										"flex h-9 w-full items-center justify-between rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:opacity-60",
										level === l ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-transparent hover:bg-accent",
									)}
								>
									{l}
									{level === l ? <span className="size-2 rounded-full bg-primary" /> : null}
								</button>
							))}
						</CardContent>
					</Card>
					{!showResult && mode === "topic" ? <TopicRun /> : null}
					{!showResult && mode === "files" ? (
						<Card>
							<CardHeader>
								<CardTitle>Scanned pages</CardTitle>
								<CardDescription>Pages that are pictures of text, and photos.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<Select<OcrMode> ariaLabel="How to read scanned pages" value={ocr} onChange={(v) => useIngest.setState({ ocr: v })} options={ocrOptions} disabled={running} />
								<div className="space-y-2.5">
									<Capability
										icon={Eye}
										ok={!!caps?.vision}
										label="AI vision"
										detail={caps?.vision ? `${caps.vision.providerName} · ${caps.vision.modelId}` : "No AI provider is set up."}
										action={
											<Link to="/settings" search={{ section: "ai" }} className="font-medium text-primary hover:underline">
												{caps?.vision ? "Change" : "Set up"}
											</Link>
										}
									/>
									<Capability
										icon={Cpu}
										ok={!!caps?.localEngine}
										label="This PC (RapidOCR)"
										detail={caps?.localEngine ? "Installed. Also saves figures from PDFs." : "Not installed. Needed for scans and figures."}
										action={
											caps?.localEngine ? undefined : (
												<Link to="/settings" search={{ section: "voice" }} className="font-medium text-primary hover:underline">
													Install
												</Link>
											)
										}
									/>
								</div>
								<Button className="w-full" disabled={!canRead} loading={running} onClick={() => void read()}>
									Read material <ArrowRight />
								</Button>
								{!items.length ? <p className="text-center text-[12px] text-muted-foreground">Add material first.</p> : null}
							</CardContent>
						</Card>
					) : null}
				</div>
			</div>
		</div>
	);
}
