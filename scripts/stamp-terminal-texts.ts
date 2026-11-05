import {
  BASELINE_PATH,
  buildBaseline,
  readBaseline,
  readPairs,
  serializeBaseline,
  structuralIssues,
} from "../app/data/terminal/text-sync";

const pairs = readPairs();
const failures = pairs.flatMap((pair) =>
  structuralIssues(pair).map((issue) => `${pair.stem} ${issue}`),
);
if (failures.length) {
  console.error(["结构未对齐，未登记译文：", ...failures].join("\n"));
  process.exit(1);
}
const previous = readBaseline();
const next = buildBaseline(pairs);
for (const [stem, memory] of Object.entries(next.files)) {
  const before = previous.files[stem] ?? {};
  const added = Object.keys(memory).filter((source) => !before[source]).length;
  const updated = Object.keys(memory).filter(
    (source) => before[source] !== undefined && before[source]?.join() !== memory[source]?.join(),
  ).length;
  const removed = Object.keys(before).filter((source) => !memory[source]).length;
  console.log(`${stem}: +${added} ~${updated} -${removed}`);
}
await Bun.write(BASELINE_PATH, serializeBaseline(next));
console.log(`已登记 ${pairs.length} 个双语文件的当前译文`);
