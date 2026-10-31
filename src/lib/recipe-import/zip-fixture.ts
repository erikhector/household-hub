import { deflateRawSync, gzipSync } from "node:zlib";

// Test helpers (GAP-67): build the byte shapes parse-file.ts reads, so the
// unit tests and the e2e spec use a real archive without a binary fixture
// checked into the repo. Not imported by app code.

export type FixtureEntry = { name: string; data: Buffer; method?: 0 | 8 };

/** A minimal zip: local headers, central directory, end record. */
export function buildZip(entries: FixtureEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const stored = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, stored);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(stored.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + stored.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

/** A `.paprikarecipes` archive: one gzipped JSON entry per recipe. */
export function buildPaprikaArchive(recipes: Record<string, unknown>[]): Buffer {
  return buildZip(
    recipes.map((recipe, i) => ({
      name: `${String(recipe.name ?? i)}.paprikarecipe`,
      data: gzipSync(Buffer.from(JSON.stringify(recipe))),
      // Paprika stores the already-gzipped entry as it is.
      method: 0 as const,
    })),
  );
}
