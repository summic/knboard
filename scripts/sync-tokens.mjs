// Re-sync the vendored kn.work design tokens into src/web/tokens.css.
//
// KN Box uses @knwork/tokens' generated CSS variables (--kn-*) but is a separate,
// independently-deployable repo, so we vendor the built artifact rather than add
// a dependency. Run `npm run tokens:sync` after the tokens change upstream.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../knwork/packages/tokens/dist/tokens.css");
const DEST = path.resolve(here, "../src/web/tokens.css");

const header = `/*
 * VENDORED from @knwork/tokens — do NOT hand-edit.
 * Source: ../../knwork/packages/tokens/dist/tokens.css
 * Re-sync with:  npm run tokens:sync
 * These are kn.work design tokens (--kn-* CSS custom properties).
 */

`;

const body = readFileSync(SRC, "utf8");
writeFileSync(DEST, header + body);
console.log(`Synced kn.work tokens → ${path.relative(process.cwd(), DEST)}`);
