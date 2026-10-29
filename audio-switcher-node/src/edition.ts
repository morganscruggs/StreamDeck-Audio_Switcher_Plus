import type { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ButtonSettings } from "./types";

// This file compiles to <sdPlugin>/bin/plugin.js, so the plugin's own root is one directory up.
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Defined by the build (`output.intro` in rollup.config.mjs).
declare const __PLUGIN_UUID__: string;

/**
 * The plugin's UUID - the full and demo builds share this code and differ only in their manifests
 * (`npm run build:demo` writes the demo's, ending in "-demo"). The build writes the UUID into the bundle
 * rather than this reading it from manifest.json at runtime: Marketplace packages protect the manifest
 * (DRM), and Elgato says not to access it at runtime. The shared property inspector tells the builds apart
 * by the same suffix. The demo is Node-only - the exe has no demo edition (see AGENTS.md).
 */
export const PLUGIN_UUID: string = __PLUGIN_UUID__;
export const IS_DEMO = PLUGIN_UUID.endsWith("-demo");

/**
 * The demo has every feature, but each key only switches devices this many times - a press that actually changes
 * the default device counts; one that changes nothing (already set, or unplugged) doesn't. The count is kept in
 * the key's own settings, so a new key starts afresh (deliberately: making new keys is allowed, just tedious).
 */
export const DEMO_SWITCHES_PER_KEY = 10;

/** How many switches the key has left; unlimited (Infinity) in the full version. */
export function switchesLeft(settings: ButtonSettings): number {
	if (!IS_DEMO) return Infinity;
	return Math.max(0, DEMO_SWITCHES_PER_KEY - (Number(settings.demoSwitchesUsed) || 0));
}

/**
 * Uses up one of the key's switches, saving the count in its settings (and in `settings`, for redrawing its
 * counter); false if it has none left. Always true in the full version.
 */
export function useSwitch(action: KeyAction<ButtonSettings>, settings: ButtonSettings): boolean {
	if (!IS_DEMO) return true;
	if (switchesLeft(settings) === 0) return false;
	settings.demoSwitchesUsed = (Number(settings.demoSwitchesUsed) || 0) + 1;
	action.setSettings(settings).catch((error) => streamDeck.logger.error("Failed to save the demo's switch count", error));
	return true;
}
