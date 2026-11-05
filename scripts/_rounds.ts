const { getLeagueByCode } = await import("../src/config/leagues.ts");
const { getLeagueData } = await import("../src/lib/leagueData.ts");
for (const code of process.argv.slice(2)) {
  const data = await getLeagueData(getLeagueByCode(code)!);
  const by = new Map<number, typeof data.fixtures>();
  for (const f of data.fixtures) by.set(f.matchday, [...(by.get(f.matchday) ?? []), f]);
  const out: string[] = [];
  for (const [r, fs] of [...by].sort((a, b) => a[0] - b[0])) {
    const played = fs.filter((f) => f.result).length;
    const ds = fs.map((f) => f.utcDate.slice(5, 10) + (f.result ? "" : "*")).sort();
    out.push(`${code} r${r} ${played}/${fs.length} ${ds.join(" ")}`);
  }
  console.log(out.filter((l) => !/ (\d+)\/\1 /.test(l) || true).slice(Number(process.env.FROM ?? 0), Number(process.env.TO ?? 99)).join("\n"));
}
