

import type { DdtDialectDatabaseMap } from "@andyrmitchell/drizzle-dialect-types";
import type { BaseItem } from "@andyrmitchell/utils/queue-base";


export type GenericDatabase = DdtDialectDatabaseMap['pg'];




export type QueueItemDB = BaseItem & {
    id: number,
    //ts: number,
    client_id: string, 
    //job_id: string,
    attempts: number,
    client_id_job_count: number,
    //descriptor?: string,
    run_id?: string,
    start_after_ts: number,
    //started_at?: number,
    completed_at: number,
}
