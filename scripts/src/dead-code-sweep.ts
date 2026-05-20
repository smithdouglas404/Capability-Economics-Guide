/**
 * Dead-code sweep across all page files.
 * Checks for:
 * 1. Unused named imports
 * 2. Orphan useState (setter never called)
 * 3. Unused const declarations in component body
 *
 * Usage: npx tsx scripts/src/dead-code-sweep.ts
 */

import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const PAGES_DIR = resolve(import.meta.dirname!, "../../artifacts/inflexcvi/src/pages");

interface Finding {
  file: string;
  line: number;
  type: "unused_import" | "orphan_state" | "unused_variable";
  symbol: string;
  detail: string;
}

function findAll(pat: RegExp, text: string): number[] {
  const results: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(pat.source, "g" + (pat.flags.includes("m") ? "m" : ""));
  while ((m = re.exec(text)) !== null) {
    results.push(m.index);
  }
  return results;
}

function lineAt(text: string, idx: number): number {
  return text.slice(0, idx).split("\n").length;
}

function analyzeFile(filePath: string): Finding[] {
  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n");
  const fileName = filePath.replace(PAGES_DIR, "").replace(/^\//, "");
  const findings: Finding[] = [];

  // --- 1. Unused named imports ---
  // Match: import { A, B as C, D } from "..."
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']\s*;?/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(text)) !== null) {
    const block = match[1];
    const names = block.split(",").map((s) => {
      const trimmed = s.trim();
      // Handle "A as B" — the local name is B
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) return asMatch[2];
      // Handle type imports
      const typeMatch = trimmed.match(/^type\s+(\w+)$/);
      if (typeMatch) return typeMatch[1];
      return trimmed;
    });

    for (const name of names) {
      if (!name || name === "") continue;
      // Count occurrences of this name outside the import line
      const importLine = lineAt(text, match.index);
      let count = 0;
      // Look for the name used as a standalone identifier (not part of another word)
      const usageRe = new RegExp(`(?<![\\w$])${escapeRegex(name)}(?![\\w$])`, "g");
      let usageMatch: RegExpExecArray | null;
      while ((usageMatch = usageRe.exec(text)) !== null) {
        const usageLine = lineAt(text, usageMatch.index);
        if (usageLine !== importLine) {
          count++;
        }
      }

      if (count === 0) {
        findings.push({
          file: fileName,
          line: importLine,
          type: "unused_import",
          symbol: name,
          detail: `Imported but never used in file body`,
        });
      }
    }
  }

  // --- 2. Default imports that might be unused ---
  // Match: import X from "..." OR import X, { ... } from "..."
  // We skip default imports of React, React hooks, and common patterns
  // We only check named default imports like `import X from "..."` where X isn't a hook/React
  const defaultImportRe = /^import\s+(\w+)\s+from\s+["']([^"']+)["']\s*;?$/gm;
  while ((match = defaultImportRe.exec(text)) !== null) {
    const name = match[1];
    const source = match[2];
    // Skip known safe defaults
    if (["React", "dynamic", "Link", "Head"].includes(name)) continue;
    if (name.startsWith("use")) continue; // hooks

    const importLine = lineAt(text, match.index);
    const usageRe = new RegExp(`(?<![\\w$])${escapeRegex(name)}(?![\\w$])`, "g");
    let count = 0;
    let usageMatch: RegExpExecArray | null;
    while ((usageMatch = usageRe.exec(text)) !== null) {
      if (lineAt(text, usageMatch.index) !== importLine) count++;
    }
    if (count === 0) {
      findings.push({
        file: fileName,
        line: importLine,
        type: "unused_import",
        symbol: name,
        detail: `Default import from "${source}" never used`,
      });
    }
  }

  // --- 3. Orphan useState ---
  // Match: const [foo, setFoo] = useState(...)
  const useStateRe = /const\s+\[(\w+),\s*(set\w+)\]\s*=\s*useState\s*\(/g;
  while ((match = useStateRe.exec(text)) !== null) {
    const valueName = match[1];
    const setterName = match[2];
    const declLine = lineAt(text, match.index);

    // Check if setter is ever called outside the declaration line
    const setterRe = new RegExp(`(?<![\\w$])${escapeRegex(setterName)}(?![\\w$])`, "g");
    let setterCalls = 0;
    let sm: RegExpExecArray | null;
    while ((sm = setterRe.exec(text)) !== null) {
      if (lineAt(text, sm.index) !== declLine) setterCalls++;
    }

    // Check if value is ever read outside the declaration line
    const valueRe = new RegExp(`(?<![\\w$])${escapeRegex(valueName)}(?![\\w$])`, "g");
    let valueReads = 0;
    let vm: RegExpExecArray | null;
    while ((vm = valueRe.exec(text)) !== null) {
      if (lineAt(text, vm.index) !== declLine) valueReads++;
    }

    if (setterCalls === 0 && valueReads === 0) {
      findings.push({
        file: fileName,
        line: declLine,
        type: "orphan_state",
        symbol: `${valueName}, ${setterName}`,
        detail: `useState value and setter are both never used`,
      });
    } else if (setterCalls === 0) {
      findings.push({
        file: fileName,
        line: declLine,
        type: "orphan_state",
        symbol: `${setterName}`,
        detail: `setter never called (value is read-only state)`,
      });
    } else if (valueReads === 0) {
      findings.push({
        file: fileName,
        line: declLine,
        type: "orphan_state",
        symbol: `${valueName}`,
        detail: `State value never read (setter is called but value is never rendered/used)`,
      });
    }
  }

  // --- 4. Orphan useRef ---
  const useRefRe = /const\s+(\w+)\s*=\s*useRef\s*\(/g;
  while ((match = useRefRe.exec(text)) !== null) {
    const refName = match[1];
    const declLine = lineAt(text, match.index);
    const usageRe = new RegExp(`(?<![\\w$])${escapeRegex(refName)}(?![\\w$])`, "g");
    let count = 0;
    let um: RegExpExecArray | null;
    while ((um = usageRe.exec(text)) !== null) {
      if (lineAt(text, um.index) !== declLine) count++;
    }
    if (count === 0) {
      findings.push({
        file: fileName,
        line: declLine,
        type: "unused_variable",
        symbol: refName,
        detail: `useRef variable never referenced outside declaration`,
      });
    }
  }

  return findings;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Main
const files = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"));
let totalFindings = 0;
const allFindings: { file: string; finding: Finding }[] = [];

for (const file of files.sort()) {
  const filePath = join(PAGES_DIR, file);
  try {
    const findings = analyzeFile(filePath);
    for (const f of findings) {
      allFindings.push({ file, finding: f });
      totalFindings++;
    }
  } catch (err) {
    console.error(`Error analyzing ${file}:`, err);
  }
}

// Group by type
const byType: Record<string, { file: string; finding: Finding }[]> = {};
for (const item of allFindings) {
  const t = item.finding.type;
  if (!byType[t]) byType[t] = [];
  byType[t].push(item);
}

console.log(`\n=== DEAD CODE SWEEP RESULTS ===`);
console.log(`Total files analyzed: ${files.length}`);
console.log(`Total findings: ${totalFindings}`);
console.log(`\n--- BY TYPE ---`);
for (const [type, items] of Object.entries(byType)) {
  console.log(`\n${type.toUpperCase()}: ${items.length} findings`);
  for (const { file, finding } of items) {
    console.log(`  ${file}:${finding.line}  ${finding.symbol} — ${finding.detail}`);
  }
}

// Also print by file
console.log(`\n--- BY FILE ---`);
const grouped: Record<string, Finding[]> = {};
for (const { file, finding } of allFindings) {
  if (!grouped[file]) grouped[file] = [];
  grouped[file].push(finding);
}
for (const [file, findings] of Object.entries(grouped).sort()) {
  console.log(`\n${file} (${findings.length}):`);
  for (const f of findings) {
    console.log(`  L${f.line} [${f.type}] ${f.symbol}`);
  }
}

console.log(`\nDone. ${totalFindings} total findings across ${Object.keys(grouped).length} files.`);
