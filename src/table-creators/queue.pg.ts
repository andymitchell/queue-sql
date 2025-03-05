
import { type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import pgTableCreatorWithSchema from "./pgTableCreatorWithSchema.ts";


export function queueTableCreatorPg(id:string, schema?:string) {

    return pgTableCreatorWithSchema(schema)("queue_"+id, {
        id: pg.integer().primaryKey().generatedAlwaysAsIdentity(),
        queue_id: pg.text().notNull(),
        item: pg.jsonb().notNull(),
        updated_at_ts: pg.timestamp().notNull().defaultNow(),//.default(sql`(strftime('%s', 'now'))`),
    }, (table) => {
        return [
            pg.index(`queue_${id}_updated_at_idx`).on(table.updated_at_ts)
        ]
    });
}


export type QueueTableCreatorPg = typeof queueTableCreatorPg;
export type QueueTablePg = ReturnType<QueueTableCreatorPg>;
export type QueueTableSelectPg = InferSelectModel<QueueTablePg>;
export type QueueTableInsertPg = InferInsertModel<QueueTablePg>;


