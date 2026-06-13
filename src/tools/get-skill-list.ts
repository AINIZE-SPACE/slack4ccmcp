// ============================================================
// Tool: get_skill_list — Read .claude/skills/ and return structured
// skill definitions so claude -p (pipe mode, no filesystem access)
// can enumerate available skills in detail.
// ============================================================

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");

interface SkillInfo {
  name: string;
  description: string;
  trigger: string[];
  sections: string[];
}

/**
 * Parse the YAML frontmatter from a SKILL.md file.
 * Returns { description, ...other } or null on failure.
 */
function parseFrontmatter(
  content: string,
): { description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = match[1];
  const out: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out.description ? { description: out.description } : null;
}

/**
 * Extract headings from the markdown body (after frontmatter) as section
 * names for the skill list summary.
 */
function extractSections(content: string): string[] {
  // strip frontmatter
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
  const headings: string[] = [];
  for (const line of body.split("\n")) {
    const h = line.match(/^##?\s+(.+)$/);
    if (h) headings.push(h[1].trim());
  }
  return headings;
}

/**
 * Scan .claude/skills/ and read all SKILL.md files.
 * Returns structured skill definitions suitable for claude -p to format
 * into a user-facing response.
 */
function scanSkills(): { skills: SkillInfo[] } {
  const skillsDir = join(projectRoot, ".claude", "skills");
  if (!existsSync(skillsDir)) return { skills: [] };

  const skills: SkillInfo[] = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    let skillFile: string | null = null;

    if (entry.isDirectory()) {
      const f = join(skillsDir, entry.name, "SKILL.md");
      if (existsSync(f)) skillFile = f;
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      skillFile = join(skillsDir, entry.name);
    }

    if (!skillFile) continue;

    try {
      const content = readFileSync(skillFile, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const sections = extractSections(content);

      skills.push({
        name: frontmatter?.description
          ? entry.name.replace(/\.md$/, "")
          : entry.name.replace(/\.md$/, ""),
        description: frontmatter?.description ?? "(no description)",
        trigger: extractTrigger(content),
        sections,
      });
    } catch {
      // skip unreadable skill files
    }
  }

  return { skills };
}

/**
 * Extract trigger phrases from the skill markdown.
 * Looks for lines like "- 用户说 \"xxx\"", "- xxx / yyy"
 */
function extractTrigger(content: string): string[] {
  const triggers: string[] = [];
  // strip frontmatter
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");

  // Look for Trigger section
  const triggerSection = body.match(/##+\s*Trigger\s*\n([\s\S]*?)(?=\n##|\n*$)/i);
  if (!triggerSection) return triggers;

  const sectionText = triggerSection[1];
  for (const line of sectionText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // bullet points and plain text
    const cleaned = trimmed
      .replace(/^[-*]\s+/, "")
      .replace(/["""]/g, '"')
      .trim();
    if (cleaned && cleaned.length < 120) {
      triggers.push(cleaned);
    }
  }
  return triggers;
}

// ---- Tool Definition ---------------------------------------------------------

export const getSkillListTool = {
  name: "slack_get_skill_list",
  description:
    "List all available ChorusGate skills with full details (name, description, " +
    "trigger phrases, and workflow sections). Call this when a user asks what " +
    "ChorusGate can do, or asks about skills / capabilities.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
  async handler() {
    return scanSkills();
  },
};
