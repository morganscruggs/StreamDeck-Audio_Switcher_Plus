import streamDeck from "@elgato/streamdeck";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AudioDeviceDirection, ButtonSettings } from "./types";
import type { ActionKind } from "./state-sync";

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
 * How many distinct devices the demo switches between in each direction (so 2 outputs and 2 inputs) - the
 * property inspector lets the user pick which.
 */
const DEMO_DEVICE_LIMIT = 2;

// The picked devices per direction: "demoDevices" holds the outputs (its name from when the demo was
// output-only), "demoInputDevices" the inputs. "demoResetCount" counts the property inspector's resets, which put
// every key back to no device.
type GlobalSettings = { demoDevices?: string[]; demoInputDevices?: string[]; demoResetCount?: number };

const demoDevices: Record<AudioDeviceDirection, string[]> = { output: [], input: [] };
let demoResetCount = 0;

function pickedDevices(list: unknown): string[] {
	return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string").slice(0, DEMO_DEVICE_LIMIT) : [];
}

function applyGlobalSettings(settings: GlobalSettings): void {
	demoDevices.output = pickedDevices(settings.demoDevices);
	demoDevices.input = pickedDevices(settings.demoInputDevices);
	demoResetCount = Number(settings.demoResetCount) || 0;
}

/** Demo build only: keeps track of the devices picked in the property inspector, stored in global settings. */
export function watchDemoDevices(): void {
	if (!IS_DEMO) return;
	streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => applyGlobalSettings(ev.settings));
	streamDeck.settings
		.getGlobalSettings<GlobalSettings>()
		.then(applyGlobalSettings)
		.catch((error) => streamDeck.logger.error("Failed to read global settings", error));
}

/**
 * Whether this build may switch to the device - always, except in the demo for devices beyond the ones
 * picked in that direction.
 */
export function isDeviceAllowed(deviceId: string, direction: AudioDeviceDirection): boolean {
	return !IS_DEMO || demoDevices[direction].includes(deviceId);
}

/**
 * The demo's fixed choices, matching what the property inspector leaves unlocked - applied here too so
 * settings it didn't write can't get around them. Either direction, the Default or Communications role (not
 * All) and either matching are allowed, and the icon is the direction's one (speaker for output, mic for
 * input). A key set up before the property inspector's latest reset has no device - that reset puts every key
 * back to "Choose a device…", but a panel can only rewrite its own key's settings, so the rest are told by the
 * reset count they were stamped with.
 */
export function applyDemoLimits(settings: ButtonSettings, kind: ActionKind): ButtonSettings {
	if (!IS_DEMO) return settings;
	const direction = settings.direction === "input" ? "input" : "output";
	const icon = direction === "input" ? "mic" : "speaker";
	const reset = (settings.demoReset ?? 0) < demoResetCount;
	return {
		...settings,
		...(reset ? { primary: undefined, primaryLabel: undefined, secondary: undefined, secondaryLabel: undefined } : {}),
		direction,
		role: settings.role === "communication" ? "communication" : "default",
		icon,
		primaryIcon: icon,
		secondaryIcon: icon,
		// Toggle's two states share the one icon, so the secondary device's is dimmed unless a color was
		// picked, to tell them apart.
		secondaryIconColor: kind === "toggle" ? settings.secondaryIconColor || "#606060" : settings.secondaryIconColor
	};
}
