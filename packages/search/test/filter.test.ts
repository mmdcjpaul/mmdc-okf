import { describe, expect, it } from "vitest";
import { buildReadFilter } from "../src/index.ts";

describe("buildReadFilter", () => {
  it("allows readable namespaces and hubs", () => {
    expect(buildReadFilter({ vaultId: "v", namespaces: ["finance", "it-support"] })).toBe(
      '(namespace IN ["finance", "it-support"] OR is_hub = true)',
    );
  });

  it("allows only hubs when nothing else is readable", () => {
    expect(buildReadFilter({ vaultId: "v", namespaces: [] })).toBe("is_hub = true");
  });

  it("quotes values so a namespace cannot widen the filter", () => {
    const f = buildReadFilter({
      vaultId: "v",
      namespaces: ['a"] OR namespace EXISTS OR x IN ["b'],
    });
    expect(f).toBe('(namespace IN ["a\\"] OR namespace EXISTS OR x IN [\\"b"] OR is_hub = true)');
  });
});
