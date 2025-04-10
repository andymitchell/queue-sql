

import type { DdtDialectDatabaseMap } from "@andyrmitchell/drizzle-dialect-types";


export type GenericDatabase = DdtDialectDatabaseMap['pg'];




export type QueueItemDB = {
    id: number,
    ts: number,
    client_id: string, 
    job_id: string,
    client_id_job_count: number,
    descriptor?: string,
    run_id?: string,
    start_after_ts: number,
    started_at?: number,
    completed_at: number,
}
