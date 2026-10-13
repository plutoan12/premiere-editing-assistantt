import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  CatalogConflictError,
  emptyCatalog,
  exportCatalog,
  importCatalog,
  type CatalogStore,
} from "@pea/media-organizer";
/** One transactional snapshot reuses the engine's versioned exact-time codec. */
export function openCatalog(path: string): CatalogStore & { close(): void } {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=3000");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1)
      throw new Error("Unsupported SQLite catalog schema");
    if (version === 0) {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      if (tables.length) throw new Error("Unrecognized SQLite catalog schema");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(
          "CREATE TABLE catalog (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL); PRAGMA user_version=1",
        );
        db.prepare("INSERT INTO catalog VALUES (1,0,?)").run(
          exportCatalog(emptyCatalog(randomUUID())),
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    const read = () => {
      const row = db
        .prepare("SELECT revision,document FROM catalog WHERE id=1")
        .get();
      if (!row || typeof row.document !== "string")
        throw new Error("Missing catalog document");
      const state = importCatalog(row.document);
      if (state.revision !== row.revision)
        throw new Error("Catalog revision mismatch");
      return state;
    };
    read(); // Fail closed before changing storage settings for unknown/corrupt data.
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    return {
      async read() {
        return read();
      },
      async commit(expected, next) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = read();
          if (expected !== current.revision || next.revision !== expected)
            throw new CatalogConflictError("catalog revision changed");
          if (next.catalogId !== current.catalogId)
            throw new CatalogConflictError("catalog identity changed");
          const document = exportCatalog({ ...next, revision: expected + 1 }),
            validated = importCatalog(document);
          db.prepare("UPDATE catalog SET revision=?,document=? WHERE id=1").run(
            validated.revision,
            document,
          );
          db.exec("COMMIT");
          return validated;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
      close() {
        db.close();
      },
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
