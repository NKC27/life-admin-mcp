/** Parsing of `claude -p --output-format stream-json` output into something the graders can inspect. */

export interface ToolCall {
  /** Tool name without the `mcp__life-admin__` prefix, e.g. `add_item`. */
  name: string;
  input: Record<string, unknown>;
  /** True when the tool result came back flagged as an error. */
  isError: boolean;
}

export interface Transcript {
  calls: ToolCall[];
  finalText: string;
  /** True when the assistant opened a skill (the Skill tool, or reading a SKILL.md or workflow file). */
  usedSkill: boolean;
  /** Set when the session itself failed (for example an expired login), as opposed to the model misbehaving. */
  failed?: string;
}

const PREFIX = "mcp__life-admin__";

export function parseTranscript(stdout: string): Transcript {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  let finalText = "";
  let failed: string | undefined;
  let sawResult = false;
  let usedSkill = false;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (
          block.type === "tool_use" &&
          (block.name === "Skill" ||
            (block.name === "Read" && /\/\.claude\/skills\//.test(String(block.input?.file_path ?? ""))))
        )
          usedSkill = true;
        if (block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith(PREFIX)) {
          const call: ToolCall = { name: block.name.slice(PREFIX.length), input: block.input ?? {}, isError: false };
          calls.push(call);
          byId.set(block.id, call);
        }
      }
    } else if (event.type === "user") {
      const content = event.message?.content;
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === "tool_result" && block.is_error) {
          const call = byId.get(block.tool_use_id);
          if (call) call.isError = true;
        }
      }
    } else if (event.type === "result") {
      sawResult = true;
      finalText = typeof event.result === "string" ? event.result : "";
      if (event.is_error) failed = finalText || "session failed";
    }
  }
  // No final result at all means the session was cut off (time limit) or crashed: not a verdict on the skill.
  if (!sawResult && !failed) failed = "the session ended without a result (timed out or crashed)";
  return { calls, finalText, failed, usedSkill };
}

export const WRITE_TOOLS = new Set([
  "add_item",
  "update_item",
  "mark_handled",
  "delete_item",
  "restore_item",
  "add_spending",
  "categorise",
  "update_pot",
  "export_calendar",
]);

export function called(t: Transcript, name: string): ToolCall[] {
  return t.calls.filter((c) => c.name === name);
}

/** Write-type calls that did not come back as errors (an import only writes with confirm: true). */
export function successfulWrites(t: Transcript): ToolCall[] {
  return t.calls.filter(
    (c) => !c.isError && (WRITE_TOOLS.has(c.name) || (c.name === "import_bank_file" && c.input.confirm === true))
  );
}
