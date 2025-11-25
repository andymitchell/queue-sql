

import { fileIoSyncNode } from "@andyrmitchell/file-io";
import { fileURLToPath } from 'url';
import { RawStoreTestSqlDbGenerator } from "./RawStoreTestSqlDbGenerator.ts";
import { QueueSql } from "./QueueSql.ts";

import {v4 as uuidV4} from 'uuid';
import { standardQueueTests } from "@andyrmitchell/utils/queue-testing";
import type { HaltPromise, QueueConstructorOptions } from "@andyrmitchell/utils/queue";
import { sleep } from "@andyrmitchell/utils";


const TESTDIR = getRelativeTestDir(import.meta.url);

beforeAll(() => {
    clearDir(TESTDIR)
})


const tdbgPg = new RawStoreTestSqlDbGenerator<'pg'>(
    TESTDIR, 
    {
        db: {
            dialect: 'pg',
            driver: 'pglite'
        },
        batch_size: 50
    });
let queueSqlsPg:Record<string, Promise<QueueSql>> = {};
async function newQueueSqlPg(queueName:string, options?: QueueConstructorOptions):Promise<QueueSql> {
    if( !queueSqlsPg[queueName] ) {

        
        queueSqlsPg[queueName] = new Promise(async accept => {
            const {db, schemas} = await tdbgPg.nextTest();
            const queueSql = new QueueSql(queueName, Promise.resolve(db), schemas, options);

            accept(queueSql);
        })
    }
    return queueSqlsPg[queueName]!
}


const tdbgSqlite = new RawStoreTestSqlDbGenerator<'sqlite'>(
    TESTDIR, 
    {
        //dialect: 'sqlite', 
        db: {
            dialect: 'sqlite',
            driver: 'better-sqlite3'
        },
        batch_size: 50
    });
let queueSqlsSqlite:Record<string, Promise<QueueSql>> = {};
async function newQueueSqlSqlite(queueName:string, options?: QueueConstructorOptions):Promise<QueueSql> {
    if( !queueSqlsSqlite[queueName] ) {

        
        queueSqlsSqlite[queueName] = new Promise(async accept => {
            const {db, schemas} = await tdbgSqlite.nextTest();
            

            const rows = await db.select().from(schemas);
            

            const queueSql = new QueueSql(queueName, Promise.resolve(db), schemas, options);

            accept(queueSql);
        })
    }
    return queueSqlsSqlite[queueName]!
}

function getRelativeTestDir(testScriptMetaUrl:string):string {
    return `${fileIoSyncNode.directory_name(fileURLToPath(testScriptMetaUrl))}/test-schemas`;
}
function clearDir(testDir:string):void {


    if( fileIoSyncNode.has_directory(testDir) ) {
        fileIoSyncNode.remove_directory(testDir, true);
    }

}


// Do for Pg

standardQueueTests(
    test, 
    expect, 
    () => {
        return (async <T>(queueName:string, onRun:(...args: any[]) => T | PromiseLike<T>, descriptor?: string, halt?: HaltPromise, enqueuedCallback?: () => void, options?:QueueConstructorOptions) => {
            const queueIDB = await newQueueSqlPg(queueName, options);
            return await queueIDB.enqueue<T>(onRun, descriptor, halt, enqueuedCallback);
        })
    },
    async (options) => {
        return newQueueSqlPg(uuidV4(), options);
    }
);


// Do for sqlite
standardQueueTests(
    test, 
    expect, 
    () => {
        return (async <T>(queueName:string, onRun:(...args: any[]) => T | PromiseLike<T>, descriptor?: string, halt?: HaltPromise, enqueuedCallback?: () => void, options?:QueueConstructorOptions) => {
            const queueIDB = await newQueueSqlSqlite(queueName, options);
            return await queueIDB.enqueue<T>(onRun, descriptor, halt, enqueuedCallback);
        })
    },
    async (options) => {
        return newQueueSqlSqlite(uuidV4(), options);
    }
);


test('creating with a closed connection can still be disposed [regression on race condition]', async () => {
    const testDir = getRelativeTestDir(import.meta.url);

    const tdbgPg = new RawStoreTestSqlDbGenerator<'pg'>(
        TESTDIR, 
        {
            db: {
                dialect: 'pg',
                driver: 'pglite'
            },
            batch_size: 50
        })
    const {db, schemas} = await tdbgPg.nextTest();

    const q = new QueueSql('test', db, schemas);
    await q.dispose();

    
    await tdbgPg.closeAllConnections();

    
    // Now satisfy that it has closed the connection (because it won't allow another attempt to run)
    let errors: Error[] = [];
    process.addListener('unhandledRejection', (e) => {
        if( e instanceof Error ) {
            errors.push(e);
        }
    })
    
    const q2 = new QueueSql('test', db, schemas);
    q2.dispose();

    await sleep(100);
    expect(errors.length>0).toBe(true);

}, 1000*15)


test('a disposed database throws an error if try to enqueue', async () => {
    const testDir = getRelativeTestDir(import.meta.url);

    const tdbgPg = new RawStoreTestSqlDbGenerator<'pg'>(
        TESTDIR, 
        {
            db: {
                dialect: 'pg',
                driver: 'pglite'
            },
            batch_size: 50
        })
    const {db, schemas} = await tdbgPg.nextTest();

    const q = new QueueSql('test', db, schemas);
    //await q.dispose();

    process.addListener('unhandledRejection', (e) => {
        // Suppress uncaught errors 
    })
    
    await tdbgPg.closeAllConnections();

    await expect(q.enqueue(() => {})).rejects.toThrow('PGlite is closed');
    

}, 1000*15)


test('postgres-rmw works', async () => {
    const testDir = getRelativeTestDir(import.meta.url);

    const tdbgPg = new RawStoreTestSqlDbGenerator<'pg'>(
        TESTDIR, 
        {
            db: {
                dialect: 'pg',
                driver: 'pglite'
            },
            batch_size: 50
        })
    const {db, schemas} = await tdbgPg.nextTest();
    
    
    await db.insert(schemas).values({ 'item': {}, 'queue_id': '1' });
    const rows = await db.select().from(schemas);

    expect(rows[0]!.queue_id).toBe('1');
    
}, 1000*15)


test('basic queue operation', async () => {
    const testDir = getRelativeTestDir(import.meta.url);

    const tdbgPg = new RawStoreTestSqlDbGenerator(
        TESTDIR, 
        {
            
            db: {
                dialect: 'pg',
                driver: 'pglite'
            },
            batch_size: 50
        })
    const {db, schemas} = await tdbgPg.nextTest();
    
    const q = new QueueSql('test', db, schemas);

    const state = {ran: false};
    await q.enqueue(() => {
        console.log("Update ze state");
        state.ran = true;
    })

    expect(state.ran).toBe(true);
    
    
}, 1000*15)
