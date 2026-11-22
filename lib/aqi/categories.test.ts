import { describe, expect, it } from "vitest";
import { getCpcbCategory } from "@/lib/aqi/categories";

describe("getCpcbCategory", () => {
  it.each([
    [0, "Good"], [50, "Good"], [51, "Satisfactory"], [100, "Satisfactory"],
    [101, "Moderate"], [200, "Moderate"], [201, "Poor"], [300, "Poor"],
    [301, "Very Poor"], [400, "Very Poor"], [401, "Severe"], [500, "Severe"]
  ])("maps CPCB AQI %i to %s", (value, expected) => {
    expect(getCpcbCategory(Number(value))).toMatchObject({ label: expected });
  });

  it.each([-1, 501, 1.5, Number.NaN])("rejects invalid AQI value %s", (value) => {
    expect(getCpcbCategory(Number(value))).toBeNull();
  });
});
