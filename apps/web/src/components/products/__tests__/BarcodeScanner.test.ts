import { acceptScannedBarcode } from "../BarcodeScanner";
import { describe, expect, it } from "vitest";

describe("acceptScannedBarcode", () => {
  it("accepts a barcode whose check digit is valid", () => {
    expect(acceptScannedBarcode("4006381333931")).toBe("4006381333931");
  });

  it("drops misreads so a blurry frame never fills the field", () => {
    expect(acceptScannedBarcode("4006381333932")).toBeNull();
    expect(acceptScannedBarcode("https://example.com")).toBeNull();
  });
});
