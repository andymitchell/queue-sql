import * as pg from "drizzle-orm/pg-core";

export default function pgTableCreatorWithSchema(schema?:string):pg.PgTableFn<undefined> {
    const tableCreator = (schema? pg.pgSchema(schema).table : pg.pgTable) as pg.PgTableFn<undefined>;
    return tableCreator;
}