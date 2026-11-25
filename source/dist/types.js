/** Locked document shapes. See memory-bank.md. */
export const SCHEMA_KIND = "schematic.schema";
export const SETTINGS_KIND = "schematic.settings";
export const FORMAT_VERSION = 1;
export const CARDINALITIES = [
    "zero-or-one",
    "zero-or-many",
    "only-one",
    "one-or-many",
];
export const CARDINALITY_LABEL = {
    "zero-or-one": "zero or one",
    "zero-or-many": "zero or many",
    "only-one": "only one",
    "one-or-many": "one or many",
};
export const CONSTRAINT_KINDS = [
    "check",
    "unique",
    "primary",
    "foreign",
    "exclude",
    "other",
];
