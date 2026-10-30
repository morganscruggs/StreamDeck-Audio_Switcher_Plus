import type { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { getVolatileDeviceId } from "./device-match";
import { audioDeviceService } from "./audio-device-service";
import { useSwitch } from "./edition";
import type { AudioDeviceDirection, AudioDeviceRole, AudioSnapshot, ButtonSettings, DirectionSnapshot } from "./types";

export type ActionKind = "set" | "toggle";

type DeviceSlot = "primary" | "secondary";

/** The direction a configured device is picked from: Set's "both" has its output as primary and its input as secondary. */
function slotDirection(settings: ButtonSettings, slot: DeviceSlot): AudioDeviceDirection {
	if (settings.direction !== "both") return settings.direction;
	return slot === "primary" ? "output" : "input";
}

function slotSnapshot(snapshot: AudioSnapshot | undefined, settings: ButtonSettings, slot: DeviceSlot): DirectionSnapshot | undefined {
	return snapshot?.[slotDirection(settings, slot)];
}

function resolveDeviceId(settings: ButtonSettings, slot: DeviceSlot, snapshot: AudioSnapshot | undefined): string {
	return getVolatileDeviceId(settings[slot], settings.matchStrategy, slotSnapshot(snapshot, settings, slot));
}

function defaultIdForRole(dirSnap: DirectionSnapshot | undefined, role: ButtonSettings["role"]): string {
	return (role === "communication" ? dirSnap?.communicationsDeviceId : dirSnap?.defaultDeviceId) ?? "";
}

/** Whether `deviceId` is already the device for every role the button sets. */
function isActiveForRole(dirSnap: DirectionSnapshot | undefined, role: ButtonSettings["role"], deviceId: string): boolean {
	if (role === "all") return deviceId === (dirSnap?.defaultDeviceId ?? "") && deviceId === (dirSnap?.communicationsDeviceId ?? "");
	return deviceId === defaultIdForRole(dirSnap, role);
}

function rolesFor(settings: ButtonSettings): AudioDeviceRole[] {
	return settings.role === "all" ? ["default", "communication"] : [settings.role];
}

/** Set's "both": its configured devices (output, then input), each with its own direction's snapshot. */
function bothDevices(settings: ButtonSettings, snapshot: AudioSnapshot | undefined): { deviceId: string; dirSnap: DirectionSnapshot | undefined }[] {
	return (["primary", "secondary"] as const)
		.map((slot) => ({ deviceId: resolveDeviceId(settings, slot, snapshot), dirSnap: slotSnapshot(snapshot, settings, slot) }))
		.filter(({ deviceId }) => deviceId);
}

/**
 * If a configured device is missing its display metadata (e.g. it was only ever saved as a bare ID),
 * backfill it from the live snapshot and persist - ported from FillButtonDeviceInfo/FillAudioDeviceInfo
 * in AudioSwitcherStreamDeckPlugin.cpp. Needed for fuzzy matching, which compares interfaceName/
 * endpointName, not just id.
 */
export async function backfillDeviceInfo(action: KeyAction<ButtonSettings>, settings: ButtonSettings, snapshot: AudioSnapshot | undefined): Promise<void> {
	let changed = false;
	for (const key of ["primary", "secondary"] as const) {
		const dirSnap = slotSnapshot(snapshot, settings, key);
		const device = settings[key];
		if (dirSnap && device?.id && !device.displayName) {
			const found = dirSnap.devices[device.id];
			if (found) {
				settings[key] = found;
				changed = true;
			}
		}
	}

	if (changed) {
		await action.setSettings(settings).catch((error) => streamDeck.logger.error("Failed to backfill device info", error));
	}
}

// Last resolved active/primary/secondary IDs per action, so polling (which re-runs updateState every
// tick, unlike the C++ plugin's change-driven callback) doesn't re-flash the alert every few seconds.
const lastResolved = new Map<string, string>();

/** Drops the per-action state kept by {@link updateState}; call when the action disappears. */
export function forgetState(actionId: string): void {
	lastResolved.delete(actionId);
	heldUpdates.delete(actionId);
}

// While a key press's switch is under way, every button's state updates are held, and once it has finished
// only the latest one per button is applied - so a change notification landing mid-switch can't show a
// button an in-between state.
let switchesInProgress = 0;
const heldUpdates = new Map<string, () => void>();

function endSwitch(): void {
	switchesInProgress = Math.max(0, switchesInProgress - 1);
	if (switchesInProgress !== 0) return;
	const updates = Array.from(heldUpdates.values());
	heldUpdates.clear();
	for (const update of updates) update();
}

/**
 * Mirrors UpdateState() in AudioSwitcherStreamDeckPlugin.cpp. With `fromPoll`, the "neither device is
 * active" alert is only shown when something actually changed since the last update.
 */
export function updateState(
	action: KeyAction<ButtonSettings>,
	kind: ActionKind,
	settings: ButtonSettings,
	snapshot: AudioSnapshot | undefined,
	fromPoll = false
): void {
	if (switchesInProgress > 0) {
		heldUpdates.set(action.id, () => updateState(action, kind, settings, snapshot, fromPoll));
		return;
	}

	if (settings.direction === "both") {
		// On only while its output and its input are both active; one left unset doesn't count against it.
		const devices = bothDevices(settings, snapshot);
		const on = devices.length > 0 && devices.every(({ deviceId, dirSnap }) => isActiveForRole(dirSnap, settings.role, deviceId));
		action.setState(on ? 0 : 1).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}

	const dirSnap = slotSnapshot(snapshot, settings, "primary");
	const primaryId = resolveDeviceId(settings, "primary", snapshot);
	const secondaryId = resolveDeviceId(settings, "secondary", snapshot);

	let activeDevice: string;
	if (settings.role === "all") {
		activeDevice = dirSnap?.defaultDeviceId ?? "";
		// This looks backwards (falling through to the communications device when the console default
		// already matches primary/secondary) but mirrors UpdateState()'s exact condition verbatim.
		if (!activeDevice || activeDevice === secondaryId || activeDevice === primaryId) {
			activeDevice = dirSnap?.communicationsDeviceId ?? "";
		}
	} else {
		activeDevice = defaultIdForRole(dirSnap, settings.role);
	}

	const resolved = `${activeDevice}|${primaryId}|${secondaryId}`;
	const unchanged = lastResolved.get(action.id) === resolved;
	lastResolved.set(action.id, resolved);

	if (kind === "set") {
		action.setState(activeDevice === primaryId ? 0 : 1).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}

	if (activeDevice === primaryId) {
		action.setState(0).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}
	if (activeDevice === secondaryId) {
		action.setState(1).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}
	if (fromPoll && unchanged) return;
	action.showAlert().catch((error) => streamDeck.logger.error("Failed to show alert", error));
}

/**
 * Handles a key press for either action, holding every button's state updates until the switch has
 * finished (see {@link heldUpdates}). Stream Deck flips a two-state key's image itself on press, so the
 * pressed key is always re-resolved afterwards, even if the press changed nothing (e.g. an unplugged
 * device), rather than being left on the image Stream Deck flipped it to.
 */
export async function performKeyPress(action: KeyAction<ButtonSettings>, kind: ActionKind, settings: ButtonSettings, state: number | undefined): Promise<void> {
	switchesInProgress++;
	heldUpdates.set(action.id, () => updateState(action, kind, settings, audioDeviceService.getSnapshot()));
	try {
		await switchDevice(action, kind, settings, state);
	} finally {
		endSwitch();
	}
}

/**
 * Ported from the shared tail of KeyUpForAction() in AudioSwitcherStreamDeckPlugin.cpp. `state` is the
 * action's state *before* this press (as reported by Stream Deck) - for Toggle, state 0 means "currently
 * showing primary, so target the secondary device" and vice versa; this looks inverted but matches the
 * original comment/behavior exactly. For Set, always targets the primary (its "secondary" concept doesn't
 * apply).
 */
async function switchDevice(action: KeyAction<ButtonSettings>, kind: ActionKind, settings: ButtonSettings, state: number | undefined): Promise<void> {
	if (settings.direction === "both") {
		await switchBothDevices(action, settings, state);
		return;
	}

	const snapshot = audioDeviceService.getSnapshot();
	const dirSnap = slotSnapshot(snapshot, settings, "primary");

	const deviceId = resolveDeviceId(settings, state !== 0 || kind === "set" ? "primary" : "secondary", snapshot);
	if (!deviceId) {
		await action.showAlert().catch(() => undefined);
		return;
	}

	const deviceState = dirSnap?.devices[deviceId]?.state;
	if (deviceState !== "connected") {
		if (kind === "set") await action.setState(1).catch(() => undefined);
		await action.showAlert().catch(() => undefined);
		return;
	}

	if (kind === "set" && isActiveForRole(dirSnap, settings.role, deviceId)) {
		if (state !== undefined) await action.setState(state).catch(() => undefined);
		return;
	}

	// The demo's per-key allowance: only a press that's about to change the device counts, and once the key has
	// none left it doesn't switch (performKeyPress re-resolves the key's state).
	if (!useSwitch(action, settings)) {
		await action.showAlert().catch(() => undefined);
		return;
	}

	await audioDeviceService.setDefaultDevices(rolesFor(settings), [deviceId]);
}

/**
 * Set's "both": sets its output and its input device together. One that's unplugged is skipped with an alert
 * rather than holding back the other, and the demo counts the press as one switch.
 */
async function switchBothDevices(action: KeyAction<ButtonSettings>, settings: ButtonSettings, state: number | undefined): Promise<void> {
	const devices = bothDevices(settings, audioDeviceService.getSnapshot());
	if (devices.length === 0) {
		await action.showAlert().catch(() => undefined);
		return;
	}

	const connected = devices.filter(({ deviceId, dirSnap }) => dirSnap?.devices[deviceId]?.state === "connected");
	const missing = connected.length < devices.length;
	const toSet = connected.filter(({ deviceId, dirSnap }) => !isActiveForRole(dirSnap, settings.role, deviceId)).map(({ deviceId }) => deviceId);

	if (toSet.length === 0) {
		if (missing) {
			await action.setState(1).catch(() => undefined);
			await action.showAlert().catch(() => undefined);
		} else if (state !== undefined) {
			await action.setState(state).catch(() => undefined);
		}
		return;
	}

	if (!useSwitch(action, settings)) {
		await action.showAlert().catch(() => undefined);
		return;
	}

	await audioDeviceService.setDefaultDevices(rolesFor(settings), toSet);
	if (missing) await action.showAlert().catch(() => undefined);
}
