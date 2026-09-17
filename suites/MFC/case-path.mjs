// Resolve an MFC case slug to its path inside the pinned checkout.
//
//   node suites/MFC/case-path.mjs <slug>          -> prints the path
//   node suites/MFC/case-path.mjs --list          -> prints every slug
//
// Parses suite.yml properly instead of grepping. The case list is a YAML
// sequence of maps, so `grep -A1 "slug: x"` reads the line after the match and
// quietly returns the wrong path as soon as anyone reorders the list, adds a
// comment between the keys, or writes path before slug.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../../scripts/lib/yaml.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const suitePath = path.join(here, "suite.yml");

let suite;
try {
  suite = parseYaml(fs.readFileSync(suitePath, "utf8"));
} catch (e) {
  process.stderr.write(`case-path: cannot read ${suitePath}: ${e.message}\n`);
  process.exit(1);
}

const cases = Array.isArray(suite.cases) ? suite.cases : [];
const slugs = cases.map((c) => c && c.slug).filter(Boolean);
const arg = process.argv[2];

if (arg === "--list") {
  process.stdout.write(slugs.join(", "));
  process.exit(0);
}

if (!arg) {
  process.stderr.write("usage: case-path.mjs <slug> | --list\n");
  process.exit(2);
}

const hit = cases.find((c) => c && c.slug === arg);
if (!hit || !hit.path) {
  process.stderr.write(`case-path: "${arg}" is not a pinned case. Available: ${slugs.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write(String(hit.path));
