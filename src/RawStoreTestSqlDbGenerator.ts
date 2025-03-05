import { TestSqlDbGenerator, createSchemaDefinitionFile, type DdtSqliteDriver, type DdtDialectDatabaseMap } from "@andyrmitchell/drizzle-fast-bulk-test";
import type { QueueTable } from "./table-creators/types.ts";
import { queueTableCreatorPg } from "./table-creators/queue.pg.ts";
import { queueTableCreatorSqlite } from "./table-creators/queue.sqlite.ts";
import type { DdtDialect } from "@andyrmitchell/drizzle-dialect-types";




type RawStoreTestSqlDb<D extends DdtDialect = DdtDialect> = {instance_id: number, db:DdtDialectDatabaseMap[D], schemas: QueueTable[D], used?: boolean};

type RawStoreTestSqlDbGeneratorOptions = {
    dialect?: DdtDialect,
    batch_size?: number, 
    sqlite_driver?: DdtSqliteDriver | null
}

export class RawStoreTestSqlDbGenerator<D extends DdtDialect = DdtDialect> {

    #options:Required<RawStoreTestSqlDbGeneratorOptions>;
    #testSqlDbGenerator:TestSqlDbGenerator<D, QueueTable[D]>;
    

    constructor(testDirAbsolutePath:string, options?: RawStoreTestSqlDbGeneratorOptions) {

        this.#options = {
            dialect: 'pg',
            batch_size: 1,
            sqlite_driver: null,
            ...options
        }

        let creatorFn:string;
        let linkFile:string;
        switch(this.#options.dialect) {
            case 'pg':
                creatorFn = 'queueTableCreatorPg'
                linkFile = 'queue.pg.ts'
                break;
            case 'sqlite':
                creatorFn = 'queueTableCreatorSqlite'
                linkFile = 'queue.sqlite.ts'
                break;
            default: 
                throw new Error("Unknown dialect")
        }


        this.#testSqlDbGenerator = new TestSqlDbGenerator<D, QueueTable[D]>(
            testDirAbsolutePath, 
            {
                dialect: this.#options.dialect,
                batch_size: this.#options.batch_size,
                sqlite_driver: this.#options.sqlite_driver? this.#options.sqlite_driver : undefined,
                generate_schemas_for_batch: async (batchPositions, batchTestDirAbsolutePath) => {
                    
                    const partitioned_schemas = batchPositions.map(batch_position => {
                        const storeId = `store${batch_position}`;
                        return {
                            batch_position,
                            store_id: storeId,
                            schemas: this.#options.dialect==='pg'? queueTableCreatorPg(storeId) : queueTableCreatorSqlite(storeId)
                        }
                    })

                    const migration_file_absolute_path = createSchemaDefinitionFile({
                        'test_dir_absolute_path': batchTestDirAbsolutePath,
                        'table_creator_import': {
                            link_file_pattern: linkFile,
                            import_name: `{${creatorFn}}`
                        },
                        'table_creator_invocation': (storeIds) => storeIds.map(storeId => `export const store_${storeId} = ${creatorFn}('${storeId}');`).join("\n")
                     },
                    partitioned_schemas.map(x => x.store_id),
                    '');

                    return {
                        partitioned_schemas,
                        migration_file_absolute_path
                    }
                }
            }
        )
    }

    async nextTest():Promise<RawStoreTestSqlDb<D>> {

        return await this.#testSqlDbGenerator.nextTest();


        
    }
}
