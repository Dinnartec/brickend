import type { AccessRule, BrickSpec, Endpoint, FieldDef } from "./brick-spec.ts";

export interface BrickSpecDiff {
	fieldsAdded: FieldDef[];
	fieldsRemoved: FieldDef[];
	fieldsChanged: Array<{ old: FieldDef; new: FieldDef }>;
	endpointsAdded: Endpoint[];
	endpointsRemoved: Endpoint[];
	accessChanged: boolean;
	configChanged: boolean;
}

export function diffBrickSpecs(oldSpec: BrickSpec, newSpec: BrickSpec): BrickSpecDiff {
	const oldFields = oldSpec.schema?.fields ?? [];
	const newFields = newSpec.schema?.fields ?? [];
	const oldEndpoints = oldSpec.api?.endpoints ?? [];
	const newEndpoints = newSpec.api?.endpoints ?? [];

	const oldFieldMap = new Map(oldFields.map((f) => [f.name, f]));
	const newFieldMap = new Map(newFields.map((f) => [f.name, f]));

	const fieldsAdded = newFields.filter((f) => !oldFieldMap.has(f.name));
	const fieldsRemoved = oldFields.filter((f) => !newFieldMap.has(f.name));
	const fieldsChanged: BrickSpecDiff["fieldsChanged"] = [];

	for (const newField of newFields) {
		const oldField = oldFieldMap.get(newField.name);
		if (oldField && !fieldDefsEqual(oldField, newField)) {
			fieldsChanged.push({ old: oldField, new: newField });
		}
	}

	const oldHandlerSet = new Set(oldEndpoints.map((e) => e.handler));
	const newHandlerSet = new Set(newEndpoints.map((e) => e.handler));

	const endpointsAdded = newEndpoints.filter((e) => !oldHandlerSet.has(e.handler));
	const endpointsRemoved = oldEndpoints.filter((e) => !newHandlerSet.has(e.handler));

	return {
		fieldsAdded,
		fieldsRemoved,
		fieldsChanged,
		endpointsAdded,
		endpointsRemoved,
		accessChanged: !accessRulesEqual(oldSpec.access, newSpec.access),
		configChanged: !deepEqual(oldSpec.config, newSpec.config),
	};
}

export function isDiffEmpty(diff: BrickSpecDiff): boolean {
	return (
		diff.fieldsAdded.length === 0 &&
		diff.fieldsRemoved.length === 0 &&
		diff.fieldsChanged.length === 0 &&
		diff.endpointsAdded.length === 0 &&
		diff.endpointsRemoved.length === 0 &&
		!diff.accessChanged &&
		!diff.configChanged
	);
}

function fieldDefsEqual(a: FieldDef, b: FieldDef): boolean {
	return (
		a.type === b.type &&
		(a.required ?? false) === (b.required ?? false) &&
		(a.nullable ?? false) === (b.nullable ?? false) &&
		(a.references ?? null) === (b.references ?? null) &&
		(a.default ?? null) === (b.default ?? null)
	);
}

function accessRulesEqual(a: AccessRule[], b: AccessRule[]): boolean {
	if (a.length !== b.length) return false;
	const serialize = (rules: AccessRule[]) =>
		JSON.stringify([...rules].sort((x, y) => x.role.localeCompare(y.role)));
	return serialize(a) === serialize(b);
}

function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
