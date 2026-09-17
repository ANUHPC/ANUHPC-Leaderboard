// Resolve an MFC case slug to the file that defines it.
//
//   node suites/MFC/case-path.mjs <slug>          -> prints the path
//   node suites/MFC/case-path.mjs <slug> --field sizing
//   node suites/MFC/case-path.mjs --list          -> prints every slug
//   node suites/MFC/case-path.mjs --json          -> the whole registry
//
// A case comes from one of two places, and the difference decides how it is
// staged and how a run of it is verified:
//
//   source: tree   the case ships with MFC. `path` is relative to the pinned
//                  checkout (/work/mfc/current/<arch>). Byte-identity comes
//                  from the commit pin -- nobody can change it without moving
//                  the pin, and render.sh refuses to run if the pin moved.
//
//   source: repo   the case was contributed here and lives at `path`, relative
//                  to the repository root. Byte-identity comes from git: every
//                  entrant resolves the same commit, and collect.mjs re-hashes
//                  the harvested case.py against the file in the tree to prove
//                  the run used exactly it.
//
// sizing decides whether --gbpp is passed to the case:
//
//   sizing: gbpp   the case implements MFC's benchmark interface -- it reads
//                  --gbpp and the --mfc dict and sizes its own grid from the
//                  rank count, so work per rank is constant as nodes grow.
//   sizing: fixed  the grid is written into the case. Passing --gbpp to a case
//                  whose argparse does not define it is a hard error, so the
//                  distinction cannot be guessed at run time.
//
// Defaults are tree/gbpp, which is what the seven original benchmark cases are,
// so entries written before these fields existed keep working unchanged.
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

export const REPO_ROOT = path.resolve(here, "..", "..");

// One place that knows what a registry entry means, so render.sh, the
// validator and the collector cannot drift apart on the defaults.
export function normalizeCase(c) {
  if (!c || !c.slug || !c.path) return null;
  return {
    slug: String(c.slug),
    path: String(c.path),
    source: c.source === "repo" ? "repo" : "tree",
    sizing: c.sizing === "fixed" ? "fixed" : "gbpp",
    title: c.title ? String(c.title) : null,
    added: c.added ? String(c.added) : null,
  };
}

export function loadCases(file = suitePath) {
  const suite = parseYaml(fs.readFileSync(file, "utf8"));
  return (Array.isArray(suite.cases) ? suite.cases : []).map(normalizeCase).filter(Boolean);
}

// Where the case file actually is. Tree cases need the architecture-specific
// checkout, which only the cluster has, so the caller supplies it.
export function resolveCase(c, treeRoot) {
  return c.source === "repo"
    ? path.join(REPO_ROOT, c.path)
    : path.join(treeRoot ?? "", c.path);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let cases;
  try {
    cases = loadCases();
  } catch (e) {
    process.stderr.write(`case-path: cannot read ${suitePath}: ${e.message}\n`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const slugs = cases.map((c) => c.slug);

  if (args[0] === "--list") {
    process.stdout.write(slugs.join(", "));
    process.exit(0);
  }
  if (args[0] === "--json") {
    process.stdout.write(JSON.stringify(cases));
    process.exit(0);
  }
  if (!args[0]) {
    process.stderr.write("usage: case-path.mjs <slug> [--field <name>] | --list | --json\n");
    process.exit(2);
  }

  const hit = cases.find((c) => c.slug === args[0]);
  if (!hit) {
    process.stderr.write(`case-path: "${args[0]}" is not a registered case. Available: ${slugs.join(", ")}\n`);
    process.exit(1);
  }

  const fieldAt = args.indexOf("--field");
  process.stdout.write(String(fieldAt === -1 ? hit.path : (hit[args[fieldAt + 1]] ?? "")));
}
