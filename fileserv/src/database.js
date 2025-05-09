const { MongoClient, ObjectId } = require("mongodb");

/*
* Abstract base class for using different database implementations.
*
* The abstracticity is implemented in a Python way, which might not
* be idiomatic Javascript.
*
* NOTE about filters:
* - All the CRUD(-like) operations operate on multiple matches of the given
*   filter.
* - An undefined filter matches all the documents in a collection.
* - The `idField` field on a filter is special meaning the unique identifier or
*   primary key of a document/record in the database represented as a string of
*   characters.
*
* NOTE about parameters and return values:
* - Like filters, creation operates on multiple i.e. a list of new documents.
* - If the `idField` is found in the document returned from database, it should
*   be possible to convert into an equivalent string representation with a
*   method `toString`.
*   For example the following way should be able to print out the document id as
*   a string:
*   ```
*   let doc = read("foo", {})[0];
*   if (idField in doc) { console.log("Id is: ", doc._id.toString()) }
*   ```
*/
class Database {
    static idField = "_id";

    constructor(value) {}

    /*
    * @throws If the database connection fails.
    */
    async connect()
    { throw "connect not implemented"; }

    async close()
    { throw "close not implemented"; }

    /*
    * C
    */
    async create(collectionName, values)
    { throw "create not implemented"; }

    /*
    * R
    * @returns Array of filter matches.
    * @throws IFF the database connection fails.
    */
    async read(collectionName, filter)
    { throw "read not implemented"; }

    /*
    * U
    */
    async update(collectionName, filter, fields, upsert=true)
    { throw "update not implemented"; }

    /*
    * D
    */
    async delete(collectionName, filter)
    { throw "delete not implemented"; }
}


class MongoDatabase extends Database {
    constructor(uri) {
        super();
        this.client = new MongoClient(uri);
    }

    async connect() {
        await this.client.connect();
        // Save reference to the actual database.
        this.db = this.client.db();
    }

    async close() {
        return this.client.close();
    }

    async create(collectionName, values)
    {
        return this.db
            .collection(collectionName)
            .insertMany(values);
    }

    async read(collectionName, filter) {
        // FIXME Crashes on bad _format_ of id (needs 12 byte or 24 hex).

        this.wrapId(filter);

        return (this.db
                .collection(collectionName)
                .find(filter)
            ).toArray();
    }

    async update(collectionName, filter, fields, upsert=true) {
        this.wrapId(filter);

        return this.db
            .collection(collectionName)
            .updateMany(
                filter,
                { $set: fields },
                // Create the fields if missing.
                { upsert: upsert }
            );

    }

    async delete(collectionName, filter) {
        this.wrapId(filter);

        return this.db
            .collection(collectionName)
            .deleteMany(filter ? filter : {});
    }

    /**
     *  Wrap a found id into Mongo's ObjectId.
     * @param {*} filter The filter to search for id field.
     */
    wrapId(filter) {
        if (filter && Database.idField in filter) {
            filter[Database.idField] = new ObjectId(filter[Database.idField].toString());
        }
    }
}

/**
 * For testing.
 */
class MockDatabase extends Database {
    constructor() {
        super();
        this.reset()
    }

    /**
     * Helper for resetting between tests.
     */
    reset() {
        this.db = {};
        this.runningId = 0;
    }

    async connect() {
        console.log("Connected to a fake database!");
    }

    async close() {
        console.log("Closing the fake database.");
    }

    async create(collectionName, documents)
    {
        // Create the collection if needed.
        if (!(collectionName in this.db)) {
            console.log(`MockDB creating collection '${collectionName}'`);
            this.db[collectionName] = {};
        }

        // Prepare bulk inserts.
        let inserts = [];
        for (let values of documents) {
            if (Database.idField in values) {
                throw `cannot create new document with an existing ${Database.idField} field ${values}`;
            }

            // Use strings for easier filters.
            values[Database.idField] = String(this.runningId);
            this.runningId += 1;
            console.log("MockDB creating new document with values", values);

            inserts.push(values);
        }

        for (let insert of inserts) {
            this.db[collectionName][insert[Database.idField]] = insert;
        }

        return { acknowledged: true, insertedIds: inserts.map(x => x[Database.idField]) };
    }

    /**
     * NOTE: Filters only on `Database.idField`!
     * @returns List of matches.
     */
    async read(collectionName, filter) {
        // TODO: This should be checked every time a collection is referenced.
        if (this.db[collectionName] === undefined) {
            this.db[collectionName] = {};
        }

        let emptyFilter = filter ? Object.keys(filter).length === 0 : true;
        if (emptyFilter) {
            return Object.values(this.db[collectionName]);
        }

        try {
            this.checkIdField(filter);
            let result = this.db[collectionName][filter[Database.idField]];
            return result ? [result] : [];
        } catch(_) {
            return [];
        }
    }

    /**
     * NOTE: Filters only on `Database.idField` and upserts otherwise (i.e., no
     * 'updateMany'-type behaviour)!
     * @returns Information on the updates made.
     */
    async update(collectionName, filter, fields, upsert=true) {
        let matches = [];
        try {
            this.checkIdField(filter)
            matches = [this.db[collectionName][filter[Database.idField]]];
        } catch(e) {
            if (upsert) {
                let insertedId = (await this.create(collectionName, [{}])).insertedIds[0];
                matches = [this.db[collectionName][insertedId]];
            }
        }

        for (let match of matches) {
            for (let [key, value] of Object.entries(fields)) {
                if (key === Database.idField) {
                    throw `changing the ID-field '${Database.idField}' is not allowed`;
                }
                match[key] = value;
            }
        }

        return { matchedCount: matches.length };
    }

    /**
     * NOTE: Filters only on `Database.idField`!
     */
    async delete(collectionName, filter) {
        let emptyFilter = filter ? Object.keys(filter).length === 0 : true;
        let deletedCount = 0;
        if (emptyFilter) {
            // Delete all.
            deletedCount = Object.keys(this.db[collectionName]).length;
            delete this.db[collectionName];
        } else {
            deletedCount = 1;
            delete this.db[collectionName][filter[Database.idField]];
        }

        return { deletedCount: deletedCount };
    }

    checkIdField(filter) {
        if (!(Database.idField in filter)) {
            throw `querying with other than the ID-field '${Database.idField}' is not possible`;
        }
    }
}

module.exports = {
    Database,
    MongoDatabase,
    MockDatabase,
};
