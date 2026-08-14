import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const OVERRIDES_FILE_PATH = join(getAgentDir(), "chat-template-kwargs.json");
const SELECTED_MARKER = "(selected)"
const CLEAR_OPTION = "off";
const NEW_OPTION = "create a new one";
const DELETE_OPTION = "delete an existing one";

interface SelectedItem {
	name: string;
	kwargs: Record<string, unknown> | undefined;
}


function loadOverrides(): Record<string, Record<string, unknown>> {
	try {
		return JSON.parse(readFileSync(OVERRIDES_FILE_PATH, "utf8"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
}

export default function (pi: ExtensionAPI) {
	let selectedItem: SelectedItem | undefined;
	let overrides: Record<string, Record<string, unknown>> = {};
	let loadError: string | undefined;

	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "startup" && event.reason !== "reload") return;

		try {
			overrides = loadOverrides();
			loadError = undefined;
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Failed to load ${OVERRIDES_FILE_PATH}: ${loadError}`, "error");
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!selectedItem) return;
		if (ctx.model?.api !== "openai-completions") return;

		const payload = event.payload as Record<string, unknown>;
		const oldKwargs = payload.chat_template_kwargs as Record<string, unknown> | undefined;
		const next = { ...payload, chat_template_kwargs: { ...oldKwargs, ...selectedItem.kwargs } };

		return next;
	});

	async function createOverride(ctx: ExtensionCommandContext): Promise<void> {
		let draft = "";
		let kwargs: Record<string, unknown>;

		while (true) {
			const raw = await ctx.ui.editor("Type the override value for \"chat_template_kwargs\" in valid JSON, e.g., {\"reasoning_strength\": \"low\"} ", draft);
			if (raw === undefined) return;
			draft = raw;
			try {
				const parsed = JSON.parse(raw); // check json valid
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
					throw new Error("top level must be a JSON object");
				}
				kwargs = parsed;
				break;
			} catch (err) {
				ctx.ui.notify(`Invalid JSON: ${err instanceof Error ? err.message : err}`, "error");
			}
		}

		let name: string;
		while (true) {
			const input = await ctx.ui.input("Name this override, e.g., low effort, no thinking");
			if (input === undefined) return;

			name = input.trim();
			if (!name) {
				ctx.ui.notify("Name cannot be empty", "warning");
				continue;
			}
			if (name === CLEAR_OPTION || name === NEW_OPTION || name === DELETE_OPTION) {
				ctx.ui.notify(`"${name}" is reserved`, "warning");
				continue;
			}
			if (name in overrides && !(await ctx.ui.confirm("Overwrite?", `"${name}" already exists`))) {
				continue;
			}
			break;
		}

		writeFileSync(OVERRIDES_FILE_PATH, `${JSON.stringify({ ...overrides, [name]: kwargs }, null, "\t")}\n`, "utf8");
		overrides = loadOverrides();
		ctx.ui.notify(`Saved chat_template_kwargs override "${name}" to ${OVERRIDES_FILE_PATH}`, "info");
	}

	async function deleteOverride(ctx: ExtensionCommandContext): Promise<void> {
		const names = Object.keys(overrides);
		if (names.length === 0) {
			ctx.ui.notify("No overrides to delete", "warning");
			return;
		}

		const name = await ctx.ui.select("Delete which override?", names);
		if (!name) return;
		if (!(await ctx.ui.confirm(`Delete "${name}"?`, JSON.stringify(overrides[name])))) return;

		const { [name]: _, ...rest } = overrides;
		writeFileSync(OVERRIDES_FILE_PATH, `${JSON.stringify(rest, null, "\t")}\n`, "utf8");
		overrides = loadOverrides();

		if (selectedItem?.name === name) {
			selectedItem = undefined;
			ctx.ui.setStatus("ctk", undefined);
		}
		ctx.ui.notify(`Deleted chat_template_kwargs override "${name}" from ${OVERRIDES_FILE_PATH}`, "info");
	}

	pi.registerCommand("ctk", {
		description: "Override chat_template_kwargs as you define",

		getArgumentCompletions: (prefix) => {
			const items = [...Object.keys(overrides), CLEAR_OPTION]
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({
					value: name,
					label: name,
					description: name === CLEAR_OPTION ? "clear override" : JSON.stringify(overrides[name]),
				}));
			return items.length > 0 ? items : null;
		},

		handler: async (args, ctx) => {
			if (loadError) {
				ctx.ui.notify(`Failed to load ${OVERRIDES_FILE_PATH}: ${loadError}`, "error");
				return;
			}

			let choice: string | undefined = args.trim() || undefined;
			while (true) {
				if (!choice) {
					const options = [...Object.keys(overrides), CLEAR_OPTION, NEW_OPTION, DELETE_OPTION].map((name) =>
						name === selectedItem?.name ? `${name} ${SELECTED_MARKER}` : name,
					);
					choice = (await ctx.ui.select("chat_template_kwargs", options))?.replace(` ${SELECTED_MARKER}`, "");
					if (!choice) return;
				}

				switch (choice) {
					case NEW_OPTION:
						await createOverride(ctx);
						choice = undefined;
						break;

					case DELETE_OPTION:
						await deleteOverride(ctx);
						choice = undefined;
						break;

					case CLEAR_OPTION:
						selectedItem = undefined
						ctx.ui.setStatus("ctk", undefined);
						ctx.ui.notify("chat_template_kwargs override cleared", "info");
						return;

					default: {
						if (!(choice in overrides)) {
							ctx.ui.notify(`Unknown override: ${choice}`, "error");
							return;
						}
						selectedItem = {name: choice, kwargs: overrides[choice]};
						const kwargsJson = JSON.stringify(selectedItem.kwargs);
						const kwargsLabel = kwargsJson.length > 30 ? `${kwargsJson.slice(0, 30)}...` : kwargsJson;
						ctx.ui.setStatus("ctk", ctx.ui.theme.fg("dim", `ctk: ${selectedItem.name} ${kwargsLabel}`));
						ctx.ui.notify(`chat_template_kwargs override is set to ${JSON.stringify(selectedItem.kwargs)}`, "info");
						return;
					}
				}
			}
		},
	});
}
