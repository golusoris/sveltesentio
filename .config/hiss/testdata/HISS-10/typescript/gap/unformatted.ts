// Formatting this repository's prettier.config.js would reject: double quotes
// against singleQuote, no trailing comma, and spaces where the tree uses tabs.
// `prettier --check .` has never run in CI, so none of it is reported.
export const greeting = {
    name: "sveltesentio",
    kind: "framework"
}
