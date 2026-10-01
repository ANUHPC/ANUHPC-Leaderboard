// Print one value out of a YAML file, for shell scripts.
//
//   node scripts/read-yaml.mjs <file> <dotted.path> [default]
//   node scripts/read-yaml.mjs <file> <dotted.path> --list
//
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./lib/yaml.mjs";

const [file, dotted, fallback = ""] = process.argv.slice(2);
const asList = fallback === "--list";

if (!file || !dotted) {
  process.stderr.write("usage: read-yaml.mjs <file> <dotted.path> [default]\n");
  process.exit(2);
}

let doc;
try {
  doc = parseYaml(fs.readFileSync(path.resolve(file), "utf8"));
} catch (e) {
  process.stderr.write(`read-yaml: cannot read ${file}: ${e.message}\n`);
  process.exit(1);
}

const value = dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), doc);

// --list: one item per line for mapfile, nothing if absent
if (asList) {
  const items = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  process.stdout.write(items.map((v) => String(v)).join("\n") + (items.length ? "\n" : ""));
  process.exit(0);
}

// missing or empty both use the default
process.stdout.write(String(value == null || value === "" ? fallback : value));
