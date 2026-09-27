/** Body sections for each note type. Hub links for the note's themes and systems go under Related. */
export const TYPE_TEMPLATES: Record<string, string[]> = {
  "How-To": ["When to use this", "Steps", "Related"],
  Process: ["Overview", "Roles", "Steps", "Related"],
  Explanation: ["Overview", "How it works", "Related"],
  Reference: ["Overview", "Details", "Related"],
  Policy: ["Policy", "Scope", "Exceptions", "Related"],
  Decision: ["Context", "Decision", "Consequences", "Related"],
  Runbook: [
    "Trigger",
    "Severity and escalation",
    "Diagnosis",
    "Resolution",
    "Verification",
    "Rollback",
    "Related",
  ],
  "Request Type": ["What happens next", "Related"],
  Action: ["When to use", "Manual procedure", "Rollback", "Related"],
  Theme: ["Overview"],
  System: ["Overview", "Access and ownership"],
  "Source Document": ["Extracted text"],
};

const PLACEHOLDERS: Record<string, string> = {
  Steps: "1. <!-- first step -->",
  "Manual procedure": "1. <!-- how a person does this by hand -->",
  Rollback: "<!-- how to undo this, or why nothing is needed -->",
};

export function templateBody(type: string, related: string[]): string {
  const sections = TYPE_TEMPLATES[type] ?? ["Overview", "Related"];
  return sections
    .map((s) => {
      if (s === "Related")
        return `# Related\n\n${related.length ? related.map((r) => `- ${r}`).join("\n") : "<!-- links to related notes -->"}\n`;
      return `# ${s}\n\n${PLACEHOLDERS[s] ?? "<!-- write here -->"}\n`;
    })
    .join("\n");
}

/** Extra frontmatter that each typed note starts with. */
export function typeDefaults(
  type: string,
  ctx: { namespace: string; slug: string; owner?: string },
): Record<string, unknown> {
  if (type === "Request Type") {
    return {
      kind: "request",
      route_to: ctx.owner ?? ctx.namespace,
      follow_up_after: "P2D",
      fields: [{ name: "details", type: "text", required: true, label: "What do you need?" }],
      examples: [],
    };
  }
  if (type === "Action") {
    return {
      execution: "manual",
      risk: "low",
      approvers: [],
      runtime: "http",
      parameters: [],
      executor: { resource: `gateway://${ctx.namespace}/${ctx.slug}`, receipt: [] },
    };
  }
  return {};
}
