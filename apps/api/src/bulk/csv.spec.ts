import { parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple header + rows into objects", () => {
    const rows = parseCsv("name,email\nAlice,alice@example.com\nBob,bob@example.com");
    expect(rows).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const rows = parseCsv('name,note\n"Acme, Inc.",hello');
    expect(rows).toEqual([{ name: "Acme, Inc.", note: "hello" }]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const rows = parseCsv('name,quote\nBob,"She said ""hi"""');
    expect(rows).toEqual([{ name: "Bob", quote: 'She said "hi"' }]);
  });

  it("handles newlines inside quoted fields", () => {
    const rows = parseCsv('name,bio\nAlice,"Line one\nLine two"');
    expect(rows).toEqual([{ name: "Alice", bio: "Line one\nLine two" }]);
  });

  it("handles \\r\\n line endings", () => {
    const rows = parseCsv("name,email\r\nAlice,alice@example.com\r\n");
    expect(rows).toEqual([{ name: "Alice", email: "alice@example.com" }]);
  });

  it("drops a trailing blank line from a file ending in a newline", () => {
    const rows = parseCsv("name\nAlice\nBob\n");
    expect(rows).toHaveLength(2);
  });

  it("fills missing trailing columns with an empty string", () => {
    const rows = parseCsv("name,email,note\nAlice,alice@example.com");
    expect(rows).toEqual([{ name: "Alice", email: "alice@example.com", note: "" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("round-trips through toCsv", () => {
    const original = [{ name: "A, B", note: 'has "quotes"' }];
    const rows = parseCsv(toCsv(original));
    expect(rows).toEqual([{ name: "A, B", note: 'has "quotes"' }]);
  });
});
