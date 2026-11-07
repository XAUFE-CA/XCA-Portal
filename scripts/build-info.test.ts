import { expect, test } from "bun:test";
import { commitUrl, parseBuildInfo } from "./build-info";

const sha = "15b7639f575a6b192e366785f83f82867bfacc2a";

test("parses the Git record into a commit link and a timestamp", () => {
  expect(parseBuildInfo(`${sha}\t15b7639\t2026-11-06T16:11:38+08:00\n`)).toEqual({
    sha,
    shortSha: "15b7639",
    committedAt: "2026-11-06 16:11:38",
    commitUrl: commitUrl(sha),
  });
});

test("rejects malformed records and tolerates a missing timestamp", () => {
  expect(parseBuildInfo("")).toBeNull();
  expect(parseBuildInfo("not-a-sha\tshort\t2026-11-06")).toBeNull();
  expect(parseBuildInfo(`${sha}\t15b7639\t`)).toMatchObject({ committedAt: "" });
});
