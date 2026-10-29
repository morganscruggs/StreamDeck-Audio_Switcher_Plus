import type { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import fs from "node:fs";
import { IS_DEMO, switchesLeft } from "./edition";
import { findIconFile } from "./icon-registry";
import { recolorPngToDataUri } from "./png-recolor";
import type { ButtonSettings } from "./types";
import type { ActionKind } from "./state-sync";

/**
 * The demo's switches-left counter: the key's icon with a red badge in its bottom-right corner, drawn as an
 * SVG (which Stream Deck takes as a key image) around the icon's PNG.
 */
function withDemoCounter(pngDataUri: string, settings: ButtonSettings): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144">` +
		`<image width="144" height="144" xlink:href="${pngDataUri}"/>` +
		`<circle cx="117" cy="117" r="23" fill="#ff3b30" stroke="#000" stroke-width="3"/>` +
		`<text x="117" y="128" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="31" font-weight="bold" fill="#fff">${switchesLeft(settings)}</text>` +
		`</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function applyStateImage(action: KeyAction<ButtonSettings>, settings: ButtonSettings, iconId: string, colorHex: string | undefined, state: 0 | 1): void {
	const file = findIconFile(iconId);
	if (!file) return;

	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(file);
	} catch (error) {
		streamDeck.logger.error(`Failed to read icon file for "${iconId}"`, error);
		return;
	}

	const png = recolorPngToDataUri(bytes, colorHex);
	action.setImage(IS_DEMO ? withDemoCounter(png, settings) : png, { state }).catch((error) => streamDeck.logger.error("Failed to set image", error));
}

/**
 * Applies both states' icons for an action - ported from ApplyIcon() in
 * AudioSwitcherStreamDeckPlugin.cpp. "Set" recolors one icon bright/dark for active/inactive (dark
 * defaults to grey #606060 when unset); "Toggle" uses two different icons, one per device, each with
 * its own optional color (no forced default - an empty color keeps the icon's own original color).
 */
export function applyIcons(action: KeyAction<ButtonSettings>, kind: ActionKind, settings: ButtonSettings): void {
	if (kind === "set") {
		const iconId = settings.icon || "headphones";
		applyStateImage(action, settings, iconId, settings.iconBrightColor, 0);
		applyStateImage(action, settings, iconId, settings.iconDarkColor || "#606060", 1);
		return;
	}

	const primaryIconId = settings.primaryIcon || "headphones";
	const secondaryIconId = settings.secondaryIcon || "speaker";
	applyStateImage(action, settings, primaryIconId, settings.primaryIconColor, 0);
	applyStateImage(action, settings, secondaryIconId, settings.secondaryIconColor, 1);
}
