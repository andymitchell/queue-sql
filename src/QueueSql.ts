
/**
 * Goal is to be a queue that works across tabs. 
 * Despite using IndexedDB, it's not intended to be durable: it still holds its jobs in memory.
 *  The IDB is just there to enforce sequential/non-concurrent task order across tabs, if they share the same IDB. 
 * 
 * Use cases
 *  - You want to run a heavy operation only once across tabs that share data. So whichever tab picks up the job first runs it, marks it complete, and no other tab races to run it concurrently. 
 * 
 * (Potentially this can also be implemented with a Broadcast Channel API, if using IndexedDB isn't desirable - e.g. too slow/heavy)
 */


import { eq, and, SQL, gte } from "drizzle-orm";
import type { GenericDatabase, QueueItemDB } from "./types.ts";
import { merge, mergeWith } from "lodash-es";
import type { QueueTable } from "./table-creators/types.ts";
import { robustTransaction } from "@andyrmitchell/drizzle-robust-transaction";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { DdtDialect, DdtDialectDatabaseMap } from "@andyrmitchell/drizzle-dialect-types";
import { BaseItemQueue, type IQueue, type IQueueIo, type QueueIoEvents } from "@andyrmitchell/utils/queue";
import { TypedCancelableEventEmitter } from "@andyrmitchell/utils/typed-cancelable-event-emitter";
import { uid } from "@andyrmitchell/utils/uid";
import { promiseWithTrigger } from "@andyrmitchell/utils";





export class QueueSql<D extends DdtDialect = DdtDialect> extends BaseItemQueue implements IQueue {

    constructor(id: string, db: DdtDialectDatabaseMap[D] | PromiseLike<DdtDialectDatabaseMap[D]>, queueSchema: QueueTable[D]) {
        super(id, new QueueIoSql(id, db, queueSchema));


    }

}


class QueueIoSql<D extends DdtDialect> implements IQueueIo {
    emitter: TypedCancelableEventEmitter<QueueIoEvents> = new TypedCancelableEventEmitter();
    #id: string;

    #db: GenericDatabase | PromiseLike<GenericDatabase>;
    #queueSchema: QueueTable['pg'];

    #nextPoll?: NodeJS.Timeout | number;
    #lastPolledAt = new Date();


    #disposed = false;

    constructor(id: string,db: DdtDialectDatabaseMap[D] | PromiseLike<DdtDialectDatabaseMap[D]>, queueSchema: QueueTable[D]) {
        this.#db = db as GenericDatabase | PromiseLike<GenericDatabase>;
        this.#queueSchema = queueSchema as QueueTable['pg'];

        this.#id = id;
        this.#pollForChanges(true);

    }


    async #pollForChanges(justSetUpInterval?: boolean) {
        if (this.#nextPoll) clearTimeout(this.#nextPoll);
        if (this.#disposed) return;


        if (!justSetUpInterval) {

            // Do the poll

            let items = await this.listItems({ updated_after: this.#lastPolledAt });
            this.#lastPolledAt = new Date();

            // TODO In theory, this could say "only in other clients", reducing the chance of an emit. Either by letting this manage client_id, or knowing which items it has modified recently. 

            if (items.length > 0) {
                this.emitter.emit('MODIFIED');
            }


        }

        // Set up the next one (remember, this class runs its own changes immediately; this is just to catch other changes elsewhere in the system)
        if (this.#disposed) return;
        this.#nextPoll = setTimeout(() => {
            this.#pollForChanges();
        }, 1000 * 20);

    }

    async addItem(item: QueueItemDB): Promise<QueueItemDB> {
        const db = await this.#db;

        const result = await db
            .insert(this.#queueSchema)
            .values({
                item,
                queue_id: this.#id,
                updated_at_ts: new Date()
            })
            .returning({
                id: this.#queueSchema.id
            })

        const id = result[0]!.id;



        item = {
            ...item,
            id
        }

        // TODO Can this be automated with a trigger to do it automatically? If you do, remember to emit MODIFIED here too.
        await this.updateItem(id, item);


        return item;
    }

    async listItems(options?: { updated_after?: Date }) {
        const db = await this.#db;
        if (this.#disposed) return [];

        let where: SQL = eq(this.#queueSchema.queue_id, this.#id);
        if (options?.updated_after) {
            where = and(
                where,
                gte(this.#queueSchema.updated_at_ts, options.updated_after)
            ) as SQL
        }

        const result = await db
            .select()
            .from(this.#queueSchema)
            .where(where)

        return result.map(x => x.item as QueueItemDB);

    }

    async nextItem(clientId: string) {
        const db = await this.#db;
        const run_id = uid();
        let firstIncompleteItem: QueueItemDB | undefined;
        let markedStarted: boolean = false;

        
        await robustTransaction(db, async tx => {
          
            if (this.#disposed) return;

            const rows = await tx
                .select({
                    item: this.#queueSchema.item
                })
                .from(this.#queueSchema)
                .where(
                    eq(this.#queueSchema.queue_id, this.#id)
                )
                .orderBy(this.#queueSchema.id)

            const items = rows.map(x => x.item as QueueItemDB);

            const somethingRunning = items.some(x => x.started_at && !x.completed_at);
            firstIncompleteItem = items.find(x => !x.completed_at);

            


            if (!somethingRunning && firstIncompleteItem && firstIncompleteItem.client_id === clientId && (firstIncompleteItem.start_after_ts < Date.now())) {
                const now = Date.now();
                firstIncompleteItem.run_id = run_id;
                firstIncompleteItem.started_at = now;
                if (this.#disposed) return;

                
                markedStarted = await this.updateItem(firstIncompleteItem.id, { run_id, started_at: now }, tx as PostgresJsDatabase);

                


            }

        }, {
            behavior: 'exclusive'
        })

        if (firstIncompleteItem && markedStarted) {
            return {
                item: firstIncompleteItem,
                run_id
            }
        }
        return undefined;

    }

    async #getItem(itemId: number, tx?: GenericDatabase) {
        const db = tx ?? await this.#db;

        const query = db
            .select()
            .from(this.#queueSchema)
            .where(this.#whereItem(itemId))

        const result = await query;
        return result[0]?.item as QueueItemDB;

    }

    #whereItem(itemId: number) {
        return and(
            eq(this.#queueSchema.queue_id, this.#id),
            eq(this.#queueSchema.id, itemId)
        )
    }

    async updateItem(itemId: number, changes: Partial<QueueItemDB>, db?: GenericDatabase) {
        db = db ?? await this.#db;

        let item = await this.#getItem(itemId, db);
        if (this.#disposed) return false;

        if (item) {
            const customMerge = (objValue: any, srcValue: any) => {
                if (srcValue === undefined) {
                    return null; // Explicitly return undefined to overwrite
                }
            };
            mergeWith(item, changes, customMerge);

            await db
                .update(this.#queueSchema)
                .set({
                    item,
                    updated_at_ts: new Date()
                })
                .where(this.#whereItem(itemId))

            this.emitter.emit('MODIFIED');

            return true;



        }

        return false;
    }

    async incrementAttempts(itemId: number, db?: GenericDatabase) {
        db = db ?? await this.#db;

        let item = await this.#getItem(itemId, db);
        if (this.#disposed) return false;
        if (item) {
            
            merge<QueueItemDB, Partial<QueueItemDB>>(item, {attempts: item.attempts+1})

            await db
                .update(this.#queueSchema)
                .set({
                    item,
                    updated_at_ts: new Date()
                })
                .where(this.#whereItem(itemId))

            this.emitter.emit('MODIFIED');

            return true;

        }

        return false;
    }

    async deleteItem(itemId: number) {
        const db = await this.#db;

        await db
            .delete(this.#queueSchema)
            .where(this.#whereItem(itemId))

    }

    async completeItem(item: QueueItemDB, force?: boolean) {
        const db = await this.#db;

        let latestItem: QueueItemDB | undefined;
        let markedComplete: boolean = false;

        
        latestItem = await this.#getItem(item.id);
        

        await robustTransaction(db, async tx => {
        //await db.transaction(async tx => {
            if (this.#disposed) return;

            latestItem = await this.#getItem(item.id, tx as GenericDatabase);

            if (!latestItem || (!force && latestItem.run_id !== item.run_id)) {
                console.warn(`QueueIDB [${this.#id}] The job running in memory did not match the job instance ID it was started with in the db.`, { latestItem, item });
                return;
            }
            if (this.#disposed) return;

            
            markedComplete = await this.updateItem(item.id, { completed_at: Date.now() }, tx as GenericDatabase);
            
        }, {
            behavior: 'exclusive'
        });

        

        if (!markedComplete) {
            throw new Error(`QueueIDB [${this.#id}] Could not mark the item as complete.\n\n${JSON.stringify({ item, latestItem })}`);
        }
    }


    async countItems(): Promise<number> {

        // TODO A more performant approach would be to have a dedicated JSON sql query per db engine to just get a COUNT
        const items = await this.listItems();
        return items.filter(x => !x.completed_at).length;

    }


    async dispose(clientId: string, progressTracker:string[]) {
        this.#disposed = true;

    
        if (this.#nextPoll) {
            clearTimeout(this.#nextPoll);
        }

        progressTracker.push('cleared next poll');
        
        const db = await this.#db;
        progressTracker.push('retrieved db');
        await db
            .delete(this.#queueSchema)
            .where(eq(this.#queueSchema.queue_id, this.#id));
    
        progressTracker.push('deleted from db');

    }

}

