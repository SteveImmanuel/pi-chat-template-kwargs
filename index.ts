import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TEMPLATES_FILE_PATH = join(getAgentDir(), "chat-template-kwargs.json");
const SELECTED_MARKER = "(selected)"
const CLEAR_OPTION = "off";

interface SelectedItem {
	name: string;
	kwargs: Record<string, unknown> | undefined;
}


function loadTemplates(): Record<string, Record<string, unknown>> {
	try {
		return JSON.parse(readFileSync(TEMPLATES_FILE_PATH, "utf8"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
}

export default function (pi: ExtensionAPI) {
	let selectedItem: SelectedItem | undefined;
	let templates: Record<string, Record<string, unknown>> = {};
	let loadError: string | undefined;

	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "startup" && event.reason !== "reload") return;

		try {
			templates = loadTemplates();
			loadError = undefined;
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Failed to load ${TEMPLATES_FILE_PATH}: ${loadError}`, "error");
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

	pi.registerCommand("ctk", {
		description: "Override chat_template_kwargs as you define",

		getArgumentCompletions: (prefix) => {
			const items = [...Object.keys(templates), CLEAR_OPTION]
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({
					value: name,
					label: name,
					description: name === CLEAR_OPTION ? "clear override" : JSON.stringify(templates[name]),
				}));
			return items.length > 0 ? items : null;
		},

		handler: async (args, ctx) => {
			if (loadError) {
				ctx.ui.notify(`Failed to load ${TEMPLATES_FILE_PATH}: ${loadError}`, "error");
				return;
			}
			if (Object.keys(templates).length === 0) {
				ctx.ui.notify(`No templates defined. Add some to ${TEMPLATES_FILE_PATH}`, "warning");
				return;
			}

			const options = [...Object.keys(templates), CLEAR_OPTION].map((name) =>
				name === selectedItem?.name ? `${name} ${SELECTED_MARKER}` : name,
			);

			const choice = (args.trim() || (await ctx.ui.select("chat_template_kwargs", options)))?.replace(
				` ${SELECTED_MARKER}`,
				"",
			);
			if (!choice) return;

			if (choice === CLEAR_OPTION) {
				selectedItem = undefined
				ctx.ui.setStatus("chat-template", undefined);
				ctx.ui.notify("chat_template_kwargs override cleared", "info");
				return;
			}

			if (!(choice in templates)) {
				ctx.ui.notify(`Unknown template: ${choice}`, "error");
				return;
			}

			selectedItem = {name: choice, kwargs: templates[choice]};
			ctx.ui.setStatus("ctk", ctx.ui.theme.fg("dim", `ctk: ${selectedItem.name}`));
			ctx.ui.notify(`ctk = ${JSON.stringify(selectedItem.kwargs)}`, "info");
		},
	});
}
