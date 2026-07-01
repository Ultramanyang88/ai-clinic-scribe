import fs from "fs";

const lines = fs.readFileSync("icd10orderfiles/icd10cm_order_2026.txt", "utf-8").split("\n");
const out: { code: string; description: string }[] = [];

for (const line of lines) {
  if (line.length < 80) continue;
  const rawCode = line.slice(6, 13).trim();   // code column
  const billable = line.slice(14, 15);        // '1' = billable leaf code
  const desc = line.slice(77).trim();         // long description column
  if (billable !== "1" || !rawCode || !desc) continue;

  const code = rawCode.length > 3
    ? `${rawCode.slice(0, 3)}.${rawCode.slice(3)}`
    : rawCode;

  out.push({ code, description: desc });
}

fs.writeFileSync("src/db/icd10-data.json", JSON.stringify(out));
console.log("wrote", out.length, "codes to src/db/icd10-data.json");