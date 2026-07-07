import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { LanguageStat, LayoutEntry, RepoAnalysis } from "./types.js";

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor",
  ".venv", "venv", "__pycache__", ".next", ".turbo", ".cache", "coverage",
]);

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust",
  ".java": "Java", ".kt": "Kotlin", ".swift": "Swift",
  ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++",
  ".cs": "C#", ".php": "PHP", ".sh": "Shell", ".bash": "Shell",
  ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".sql": "SQL",
  ".md": "Markdown", ".yml": "YAML", ".yaml": "YAML", ".json": "JSON",
  ".toml": "TOML", ".vue": "Vue", ".svelte": "Svelte",
};

const MANIFEST_FILES = [
  "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml",
  "go.mod", "Gemfile", "pom.xml", "build.gradle", "composer.json",
];

/** Well-known npm deps mapped to a human-readable framework/tool name. */
const FRAMEWORK_HINTS: Record<string, string> = {
  react: "React", next: "Next.js", vue: "Vue", svelte: "Svelte",
  express: "Express", fastify: "Fastify", hono: "Hono", nestjs: "NestJS",
  vite: "Vite", webpack: "Webpack", jest: "Jest", vitest: "Vitest",
  tailwindcss: "Tailwind CSS", prisma: "Prisma", typescript: "TypeScript",
};

const DIR_NOTES: Record<string, string> = {
  src: "main source code",
  lib: "library code",
  test: "tests",
  tests: "tests",
  docs: "documentation",
  examples: "usage examples",
  scripts: "maintenance / build scripts",
  public: "static assets",
  assets: "static assets",
  ".github": "GitHub config (CI, templates)",
  packages: "workspace packages (monorepo)",
  apps: "workspace apps (monorepo)",
};

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function walk(root: string, dir: string, langCounts: Map<string, number>, counter: { n: number }): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(root, join(dir, entry.name), langCounts, counter);
      continue;
    }
    counter.n++;
    const lang = EXT_TO_LANGUAGE[extname(entry.name).toLowerCase()];
    if (lang) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
}

/** Analyze a repository directory and return a structured summary. */
export function analyzeRepo(root: string): RepoAnalysis {
  const langCounts = new Map<string, number>();
  const counter = { n: 0 };
  walk(root, root, langCounts, counter);

  const languages: LanguageStat[] = [...langCounts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files);

  const manifests = MANIFEST_FILES.filter((f) => existsSync(join(root, f)));

  let name = basename(root);
  let description: string | null = null;
  let scripts: Record<string, string> = {};
  let dependencies: string[] = [];
  const frameworks = new Set<string>();

  if (manifests.includes("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      if (pkg.name) name = pkg.name;
      if (pkg.description) description = pkg.description;
      scripts = pkg.scripts ?? {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      dependencies = Object.keys(deps);
      for (const dep of dependencies) {
        if (FRAMEWORK_HINTS[dep]) frameworks.add(FRAMEWORK_HINTS[dep]);
      }
    } catch {
      // malformed package.json: fall through with defaults
    }
  }

  if (!description) {
    const readmePath = ["README.md", "readme.md", "README"].map((f) => join(root, f)).find(existsSync);
    if (readmePath) {
      const firstText = readFileSync(readmePath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && !l.startsWith("!["));
      if (firstText) description = firstText;
    }
  }

  const layout: LayoutEntry[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      layout.push({ path: entry.name + "/", kind: "dir", note: DIR_NOTES[entry.name] ?? "" });
    } else if (MANIFEST_FILES.includes(entry.name) || /\.(md|toml|json|ya?ml)$/i.test(entry.name)) {
      layout.push({ path: entry.name, kind: "file", note: "" });
    }
  }
  layout.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "dir" ? -1 : 1));

  const existingDocs = ["README.md", "CONTRIBUTING.md", "CLAUDE.md", "AGENTS.md", "docs"]
    .filter((f) => existsSync(join(root, f)))
    .map((f) => (statSync(join(root, f)).isDirectory() ? f + "/" : f));

  const hasTests =
    existsSync(join(root, "test")) ||
    existsSync(join(root, "tests")) ||
    existsSync(join(root, "src", "test")) ||
    Object.keys(scripts).includes("test");
  const hasCI = existsSync(join(root, ".github", "workflows"));

  const remote = git(root, ["remote", "get-url", "origin"]);
  const headRef = git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const defaultBranch = headRef ? headRef.split("/").pop() ?? null : git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

  return {
    root,
    name,
    description,
    languages,
    frameworks: [...frameworks].sort(),
    manifests,
    scripts,
    dependencies,
    layout,
    existingDocs,
    hasTests,
    hasCI,
    remote,
    defaultBranch,
    fileCount: counter.n,
  };
}

/** Relative path helper used by generators to reference files portably. */
export function rel(root: string, p: string): string {
  return relative(root, p) || ".";
}
