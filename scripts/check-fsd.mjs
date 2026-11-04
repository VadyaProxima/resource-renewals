import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const root = resolve("apps/web/src");
const layers = ["shared", "entities", "features", "widgets", "pages", "app"];
let errors = 0;
const parts = (path) => relative(root, path).split(sep);
function fail(file, spec, message) {
  console.error(`${relative(root, file)}: ${spec} — ${message}`);
  errors++;
}

async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    const source = parts(file);
    const imports = ts.preProcessFile(
      await readFile(file, "utf8"),
      true,
      true,
    ).importedFiles;
    for (const { fileName: spec } of imports) {
      if (spec.startsWith("@renewals/") && spec !== "@renewals/contracts") {
        fail(file, spec, "разрешен только общий пакет контрактов");
        continue;
      }
      if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
      const target = parts(
        spec.startsWith("@/")
          ? resolve(root, spec.slice(2))
          : resolve(dirname(file), spec),
      );
      const sourceLevel = layers.indexOf(source[0]);
      const targetLevel = layers.indexOf(target[0]);
      if (targetLevel === -1) {
        fail(file, spec, "импорт выходит за пределы слоев FSD");
        continue;
      }
      const sameScope =
        source[0] === target[0] &&
        (source[0] === "app" || source[1] === target[1]);
      if (sameScope) continue;
      if (targetLevel >= sourceLevel) {
        fail(file, spec, "разрешены только нижние слои, без cross-imports");
        continue;
      }
      if (target.length !== 2)
        fail(
          file,
          spec,
          "импортируйте через public API слайса или shared-сегмента",
        );
    }
  }
}
await walk(root);
if (errors) process.exitCode = 1;
else
  console.log(
    "FSD: слои, cross-imports и public API проверены для alias и относительных импортов",
  );
