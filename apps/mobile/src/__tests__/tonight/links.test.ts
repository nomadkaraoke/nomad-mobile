import { parseNightLink } from "../../tonight/links";

describe("parseNightLink", () => {
  it.each([
    ["HTTP://KJBOX.CC/2121", "2121"],
    ["https://kjbox.cc/2121", "2121"],
    ["https://www.kjbox.cc/2121/", "2121"],
    ["https://sing.nomadkaraoke.com/?t=2121", "2121"],
    ["https://sing.nomadkaraoke.com/sing/?t=2121", "2121"],
    ["nomadkaraoke://tonight?t=2121", "2121"],
    ["nomadkaraoke:///tonight?t=2121", "2121"],
    ["  2121\n", "2121"],
    ["12345678", "12345678"],
  ])("%j -> %s", (input, code) => {
    expect(parseNightLink(input)).toEqual({ code });
  });

  it.each([
    "",
    "   ",
    "123",
    "123456789",
    "abcd",
    "https://kjbox.cc",
    "https://kjbox.cc/",
    "https://kjbox.cc/2121/extra",
    "https://kjbox.cc/abcd",
    "https://evil.com/2121",
    "https://sing.nomadkaraoke.com/?t=abc",
    "https://sing.nomadkaraoke.com/other?t=2121",
    "https://sing.nomadkaraoke.com/",
    "nomadkaraoke://tonight",
    "nomadkaraoke://song?t=2121",
    "ftp://kjbox.cc/2121",
  ])("rejects %j", (input) => {
    expect(parseNightLink(input)).toBeNull();
  });
});
