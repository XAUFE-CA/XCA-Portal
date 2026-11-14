import { checkRegistry, countsByLevel } from "../tests/test-registry";

const report = await checkRegistry();
if (report.issues.length) {
  console.error(report.issues.join("\n"));
  process.exitCode = 1;
} else {
  const counts = countsByLevel(report.scopes);
  console.log(
    `Test registry passed (${report.scopes.length} scopes, ${report.files.length} files: ` +
      `${counts.unit} unit, ${counts.module} module, ${counts.system} system)`,
  );
}
