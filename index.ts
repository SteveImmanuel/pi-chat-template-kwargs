import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TEMPLATES: Record<string, Record<string, unknown>> = {
	"low": { reasoning_effort: 'low' },
	"xhigh": { reasoning_effort: 'xhigh' },
};

const CLEAR_OPTION = "off";

interface SelectedItem {
	name: string;
	kwargs: Record<string, unknown> | undefined;
}

export default function (pi: ExtensionAPI) {
	let selectedItem: SelectedItem | undefined;

	pi.on("before_provider_request", (event, ctx) => {
		if (!selectedItem?.kwargs) return;
		if (ctx.model?.api !== "openai-completions") return;

		const payload = event.payload as Record<string, unknown>;
		const oldKwargs = payload.chat_template_kwargs as Record<string, unknown> | undefined;
		const next = { ...payload, chat_template_kwargs: { ...oldKwargs, ...selectedItem.kwargs } };

		return next;
	});

	pi.registerCommand("chat-template", {
		description: "Override chat_template_kwargs as you define",

		getArgumentCompletions: (prefix) => {
			const items = [...Object.keys(TEMPLATES), CLEAR_OPTION]
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({
					value: name,
					label: name,
					description: name === CLEAR_OPTION ? "clear override" : JSON.stringify(TEMPLATES[name]),
				}));
			return items.length > 0 ? items : null;
		},

		handler: async (args, ctx) => {
			const options = [...Object.keys(TEMPLATES), CLEAR_OPTION].map((name) =>
				name === selectedItem?.name ? `${name} (active)` : name,
			);

			const choice = (args.trim() || (await ctx.ui.select("chat_template_kwargs", options)))?.replace(
				" (active)",
				"",
			);
			if (!choice) return;

			if (choice === CLEAR_OPTION) {
				selectedItem = undefined
				ctx.ui.setStatus("chat-template", undefined);
				ctx.ui.notify("chat_template_kwargs override cleared", "info");
				return;
			}

			if (!(choice in TEMPLATES)) {
				ctx.ui.notify(`Unknown template: ${choice}`, "error");
				return;
			}

			selectedItem = {name: choice, kwargs: TEMPLATES[choice]};
			ctx.ui.setStatus("ctk", ctx.ui.theme.fg("dim", `ctk: ${selectedItem.name}`));
			ctx.ui.notify(`ctk = ${JSON.stringify(selectedItem.kwargs)}`, "info");
		},
	});
}
