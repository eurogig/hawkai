import YAML from "yaml";
import type { CompiledRule, RuleDefinition, RulePackIndex } from "@/types";

interface RuleManifest {
  packs: string[];
  metadata: string;
}

const GLOB_TOKEN = /[.+^=!:${}()|[\]\\]/g;

export async function loadRuleIndex(signal?: AbortSignal): Promise<RulePackIndex> {
  const manifest = await fetchManifest(signal);
  const [rules, owasp] = await Promise.all([
    loadRuleDefinitions(manifest.packs, signal),
    loadOwaspMetadata(manifest.metadata, signal)
  ]);

  return { rules, owasp };
}

async function fetchManifest(signal?: AbortSignal): Promise<RuleManifest> {
  const baseUrl = import.meta.env.BASE_URL;
  const manifestPath = `${baseUrl}rules/index.json`.replace(/\/+/g, "/");
  const res = await fetch(manifestPath, { cache: "no-store", signal });
  if (!res.ok) {
    throw new Error("Unable to load rule manifest");
  }
  return (await res.json()) as RuleManifest;
}

async function loadRuleDefinitions(files: string[], signal?: AbortSignal): Promise<RuleDefinition[]> {
  const baseUrl = import.meta.env.BASE_URL;
  const results = await Promise.all(
    files.map(async (file) => {
      const rulePath = `${baseUrl}rules/${file}`.replace(/\/+/g, "/");
      const res = await fetch(rulePath, { cache: "no-store", signal });
      if (!res.ok) {
        throw new Error(`Failed to load rule pack ${file}`);
      }
      const raw = await res.text();
      const parsed = YAML.parse(raw) as RuleDefinition[];
      return parsed;
    })
  );

  return results.flat();
}

async function loadOwaspMetadata(file: string, signal?: AbortSignal) {
  const baseUrl = import.meta.env.BASE_URL;
  const metadataPath = `${baseUrl}rules/${file}`.replace(/\/+/g, "/");
  const res = await fetch(metadataPath, { cache: "no-store", signal });
  if (!res.ok) {
    throw new Error("Failed to load OWASP metadata");
  }
  const raw = await res.text();
  return YAML.parse(raw) as RulePackIndex["owasp"];
}

export function compileRules(ruleDefs: RuleDefinition[]): CompiledRule[] {
  return ruleDefs
    .map((rule) => {
      try {
        return {
          ...rule,
          regex: new RegExp(rule.contentRegex, "gi"),
          globMatchers: rule.fileGlobs.map(globToRegExp)
        } satisfies CompiledRule;
      } catch (error) {
        console.warn(`Failed to compile rule ${rule.id}`, error);
        return undefined;
      }
    })
    .filter(Boolean) as CompiledRule[];
}

function globToRegExp(glob: string): RegExp {
  let regex = glob
    .replace(GLOB_TOKEN, "\\$&")
    .replace(/\*\*/g, "(.*)")
    .replace(/\*/g, "([^/]*)")
    .replace(/\?/g, ".");
  regex = `^${regex}$`;
  return new RegExp(regex, "i");
}

export function ruleAppliesToPath(rule: CompiledRule, path: string): boolean {
  return rule.globMatchers.some((matcher) => matcher.test(path));
}
