import { render } from "@testing-library/react";
import axe from "axe-core";
import { expect, it } from "vitest";
it("axe rileva davvero i problemi (controllo di sanità del test)", async () => {
  const { container } = render(<div><button /><img src="x.png" /><input /></div>);
  const r = await axe.run(container);
  expect(r.violations.map((v) => v.id).sort()).toEqual(expect.arrayContaining(["button-name", "image-alt", "label"]));
});
