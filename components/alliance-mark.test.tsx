import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AllianceMark } from "./alliance-mark";

describe("default alliance emblem", () => {
  it("keeps the same default emblem before setup and after changing name, tag or server", () => {
    for (const alliance of [undefined, { name: "The Rascals", tag: "RSCL", server: "927" }, { name: "Phoenix Guard", tag: "PHNX", server: "1234" }]) {
      const html = renderToStaticMarkup(<AllianceMark alliance={alliance} />);
      expect(html).toContain("rscl-alliance-emblem.png");
    }
  });
});
