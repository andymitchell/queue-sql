
import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import * as sqlite from "drizzle-orm/sqlite-core"; 


export function queueTableCreatorSqlite(id:string, schema?:string) {
    if( schema ) throw new Error("Schema not supported in sqlite");

    return sqlite.sqliteTable("queue_"+id, {
        id: sqlite.integer("id").primaryKey({ autoIncrement: true }),
        queue_id: sqlite.text().notNull(),
        item: sqlite.text({mode: 'json'}),
        updated_at_ts: sqlite.int({'mode': 'timestamp'}).notNull().default(sql`(unixepoch())`),//.default(sql`(strftime('%s', 'now'))`),
    }, (table) => {
        return {
            [`queue_${id}_updated_at_idx`]: sqlite.index(`queue_${id}_updated_at_idx`).on(table.updated_at_ts)
        }
    });

}


export type QueueTableCreatorSqlite = typeof queueTableCreatorSqlite;
export type QueueTableSqlite = ReturnType<QueueTableCreatorSqlite>;
export type QueueTableSelectSqlite = InferSelectModel<QueueTableSqlite>;
export type QueueTableInsertSqlite = InferInsertModel<QueueTableSqlite>;




